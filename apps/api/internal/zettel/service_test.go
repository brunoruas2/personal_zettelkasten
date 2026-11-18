package zettel_test

import (
	"context"
	"errors"
	"path/filepath"
	"regexp"
	"strings"
	"testing"

	"github.com/brunofullstack/zettelkasten/api/internal/auth"
	"github.com/brunofullstack/zettelkasten/api/internal/db"
	"github.com/brunofullstack/zettelkasten/api/internal/images"
	"github.com/brunofullstack/zettelkasten/api/internal/zettel"
)

type recNotifier struct{ events []zettel.ChangeEvent }

func (r *recNotifier) Changed(_ context.Context, _ string, ev zettel.ChangeEvent) {
	r.events = append(r.events, ev)
}

type svcEnv struct {
	svc   *zettel.Service
	notes *recNotifier
	user  string
	ctx   context.Context
}

func newSvc(t *testing.T) *svcEnv {
	t.Helper()
	database, err := db.Open(filepath.Join(t.TempDir(), "t.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { database.Close() })
	u, err := auth.NewRepository(database).CreateUser("alice", "password-a", "member")
	if err != nil {
		t.Fatal(err)
	}
	n := &recNotifier{}
	svc := zettel.NewService(zettel.NewRepository(database), images.NewRepository(database)).WithNotifier(n)
	return &svcEnv{svc: svc, notes: n, user: u.ID, ctx: context.Background()}
}

func (e *svcEnv) mk(t *testing.T, title, body string, tags ...string) string {
	t.Helper()
	z, err := e.svc.Create(e.ctx, e.user, zettel.CreateInput{Title: title, Body: body, Tags: tags})
	if err != nil {
		t.Fatal(err)
	}
	return z.ID
}

func (e *svcEnv) body(t *testing.T, id string) string {
	t.Helper()
	z, err := e.svc.Get(e.user, id)
	if err != nil {
		t.Fatal(err)
	}
	return z.Body
}

func outIDs(t *testing.T, e *svcEnv, id string) []string {
	t.Helper()
	out, _, err := e.svc.Links(e.user, id)
	if err != nil {
		t.Fatal(err)
	}
	ids := []string{}
	for _, l := range out {
		ids = append(ids, l.ID)
	}
	return ids
}

func TestServiceCreateGeneratesIDAndResolvesLinks(t *testing.T) {
	e := newSvc(t)
	other := e.mk(t, "Outro", "")
	id := e.mk(t, "Novo", "veja [[Outro]]")
	if !regexp.MustCompile(`^\d{14}[a-z0-9]{4}$`).MatchString(id) {
		t.Fatalf("id fora do formato: %q", id)
	}
	if got := outIDs(t, e, id); len(got) != 1 || got[0] != other {
		t.Fatalf("link não resolvido: %v", got)
	}
}

func TestServicePatch(t *testing.T) {
	e := newSvc(t)
	id := e.mk(t, "P", "a b c")
	before, _ := e.svc.Get(e.user, id)
	z, err := e.svc.Patch(e.ctx, e.user, id, "b", "x")
	if err != nil {
		t.Fatal(err)
	}
	if z.Body != "a x c" || z.UpdatedAt <= before.UpdatedAt {
		t.Fatalf("patch: body=%q updated_at %d → %d", z.Body, before.UpdatedAt, z.UpdatedAt)
	}

	id2 := e.mk(t, "Q", "b b")
	n := len(e.notes.events)
	_, err = e.svc.Patch(e.ctx, e.user, id2, "b", "x")
	var pm *zettel.PatchMismatchError
	if !errors.Is(err, zettel.ErrPatchMismatch) || !errors.As(err, &pm) || pm.Count != 2 {
		t.Fatalf("ambíguo: want PatchMismatch(2), got %v", err)
	}
	if e.body(t, id2) != "b b" {
		t.Fatal("patch ambíguo alterou o corpo")
	}
	if len(e.notes.events) != n {
		t.Fatal("falha notificou")
	}
}

func TestServiceSetTags(t *testing.T) {
	e := newSvc(t)
	id := e.mk(t, "T", "", "a", "b")
	z, err := e.svc.SetTags(e.ctx, e.user, id, []string{"Nova Tag"}, []string{"a"})
	if err != nil {
		t.Fatal(err)
	}
	if strings.Join(z.Tags, ",") != "b,nova-tag" {
		t.Fatalf("tags: %v", z.Tags)
	}
}

func TestServiceRenameRewritesLinks(t *testing.T) {
	e := newSvc(t)
	id := e.mk(t, "Velho", "")
	citing := e.mk(t, "Cita", "[[velho]] e [[^Velho]] e [[Velho|aqui]] e [[Velhote]]")
	untouched := e.mk(t, "Nada", "sem links")

	z, rewritten, err := e.svc.Rename(e.ctx, e.user, id, "Novo")
	if err != nil {
		t.Fatal(err)
	}
	if z.Title != "Novo" {
		t.Fatalf("título: %q", z.Title)
	}
	if want := "[[Novo]] e [[^Novo]] e [[Novo|aqui]] e [[Velhote]]"; e.body(t, citing) != want {
		t.Fatalf("reescrita: %q", e.body(t, citing))
	}
	if len(rewritten) != 1 || rewritten[0] != citing {
		t.Fatalf("ids reescritos: %v", rewritten)
	}
	if e.body(t, untouched) != "sem links" {
		t.Fatal("zettel sem link mudou")
	}
	if got := outIDs(t, e, citing); len(got) != 1 || got[0] != id {
		t.Fatalf("links depois do rename: %v", got)
	}
	last := e.notes.events[len(e.notes.events)-1]
	if last.Op != "upsert" || len(last.IDs) != 2 {
		t.Fatalf("notificação do rename: %+v", last)
	}
}

func TestServiceRenameConflict(t *testing.T) {
	e := newSvc(t)
	id := e.mk(t, "A", "")
	e.mk(t, "Ocupado", "")
	citing := e.mk(t, "C", "[[A]]")
	if _, _, err := e.svc.Rename(e.ctx, e.user, id, "ocupado"); !errors.Is(err, zettel.ErrConflict) {
		t.Fatalf("want ErrConflict, got %v", err)
	}
	if z, _ := e.svc.Get(e.user, id); z.Title != "A" {
		t.Fatal("título mudou num conflito")
	}
	if e.body(t, citing) != "[[A]]" {
		t.Fatal("corpo mudou num conflito")
	}
}

func TestServiceRelinksPendingOnCreate(t *testing.T) {
	e := newSvc(t)
	old := e.mk(t, "Antigo", "vai existir: [[Futuro]]")
	before, _ := e.svc.Get(e.user, old)
	fut := e.mk(t, "Futuro", "")
	if got := outIDs(t, e, old); len(got) != 1 || got[0] != fut {
		t.Fatalf("link pendente não religado: %v", got)
	}
	after, _ := e.svc.Get(e.user, old)
	if after.UpdatedAt != before.UpdatedAt {
		t.Fatal("religar alterou updated_at")
	}
}

func TestServiceNotifiesWithSource(t *testing.T) {
	e := newSvc(t)
	ctx := context.WithValue(context.Background(), auth.SourceKey, auth.SourceAgent)
	z, err := e.svc.Create(ctx, e.user, zettel.CreateInput{Title: "X"})
	if err != nil {
		t.Fatal(err)
	}
	ev := e.notes.events[len(e.notes.events)-1]
	if ev.Op != "upsert" || ev.Source != auth.SourceAgent || len(ev.IDs) != 1 || ev.IDs[0] != z.ID {
		t.Fatalf("evento: %+v", ev)
	}
	if err := e.svc.Delete(e.ctx, e.user, z.ID); err != nil {
		t.Fatal(err)
	}
	ev = e.notes.events[len(e.notes.events)-1]
	if ev.Op != "delete" || ev.Source != auth.SourceUI {
		t.Fatalf("evento de delete: %+v", ev)
	}
}

func TestServiceNotFound(t *testing.T) {
	e := newSvc(t)
	_, err := e.svc.Update(e.ctx, e.user, "nope", zettel.UpdateInput{Title: "x"})
	if !errors.Is(err, zettel.ErrNotFound) {
		t.Fatalf("want ErrNotFound, got %v", err)
	}
	if err := e.svc.Delete(e.ctx, e.user, "nope"); !errors.Is(err, zettel.ErrNotFound) {
		t.Fatalf("delete: want ErrNotFound, got %v", err)
	}
}

func TestServiceSearchAndTags(t *testing.T) {
	e := newSvc(t)
	e.mk(t, "Recursão", "funções que chamam a si mesmas", "algoritmos")
	e.mk(t, "Iteração", "laços", "algoritmos", "basico")
	zs, err := e.svc.Search(e.user, `recurs" (`, 10)
	if err != nil {
		t.Fatalf("busca com sintaxe FTS: %v", err)
	}
	if len(zs) != 1 || zs[0].Title != "Recursão" {
		t.Fatalf("busca: %v", zs)
	}
	tags, err := e.svc.Tags(e.user)
	if err != nil {
		t.Fatal(err)
	}
	if len(tags) != 2 || tags[0].Tag != "algoritmos" || tags[0].Count != 2 {
		t.Fatalf("tags: %+v", tags)
	}
	if z, err := e.svc.GetByTitle(e.user, "RECURSÃO"); err != nil || z.Title != "Recursão" {
		t.Fatalf("GetByTitle sem caixa: %v %v", z, err)
	}
}
