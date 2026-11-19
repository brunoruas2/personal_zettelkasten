package types_test

import (
	"errors"
	"fmt"
	"path/filepath"
	"testing"

	"github.com/brunofullstack/zettelkasten/api/internal/auth"
	"github.com/brunofullstack/zettelkasten/api/internal/db"
	"github.com/brunofullstack/zettelkasten/api/internal/models"
	"github.com/brunofullstack/zettelkasten/api/internal/types"
	"github.com/brunofullstack/zettelkasten/api/internal/zettel"
)

type env struct {
	repo   *types.Repository
	zrepo  *zettel.Repository
	userA  string
	userB  string
	dbPath string
}

func newEnv(t *testing.T) *env {
	t.Helper()
	database, err := db.Open(filepath.Join(t.TempDir(), "t.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { database.Close() })
	ar := auth.NewRepository(database)
	a, err := ar.CreateUser("alice", "password-a", "member")
	if err != nil {
		t.Fatal(err)
	}
	b, err := ar.CreateUser("bob", "password-b", "member")
	if err != nil {
		t.Fatal(err)
	}
	return &env{repo: types.NewRepository(database), zrepo: zettel.NewRepository(database), userA: a.ID, userB: b.ID}
}

func (e *env) zettel(t *testing.T, user, id string) {
	t.Helper()
	z := &models.Zettel{ID: id, UserID: user, Title: "Zettel " + id, Body: "corpo", Tags: []string{}, CreatedAt: 1, UpdatedAt: 1}
	if err := e.zrepo.Create(z); err != nil {
		t.Fatal(err)
	}
}

func typ(id, slug string, updated int64) types.Type {
	return types.Type{
		ID: id, Name: "Tipo " + slug, Slug: slug, Icon: "📘", Color: "#a78bfa",
		ProtectedSections: []string{"Minha síntese"},
		Levels: []types.Level{
			{Key: "semente", Label: "Semente", Emoji: "🤖"},
			{Key: "testado", Label: "Testado", Emoji: "💾"},
			{Key: "consolidado", Label: "Consolidado", Emoji: "🧠", UserOnly: true},
		},
		CountsProgress: true,
		UpdatedAt:      updated,
	}
}

func TestUpsertGravaELe(t *testing.T) {
	e := newEnv(t)
	if _, err := e.repo.Upsert(e.userA, []types.Type{typ("t1", "conteudo", 1000)}, 5000); err != nil {
		t.Fatal(err)
	}
	got, err := e.repo.Get(e.userA, "t1")
	if err != nil {
		t.Fatal(err)
	}
	if got.Slug != "conteudo" || len(got.Levels) != 3 || !got.Levels[2].UserOnly || !got.CountsProgress {
		t.Fatalf("tipo gravado errado: %+v", got)
	}
	if len(got.ProtectedSections) != 1 || got.ProtectedSections[0] != "Minha síntese" {
		t.Fatalf("seções: %v", got.ProtectedSections)
	}
}

func TestLWWPorUpdatedAtDoCliente(t *testing.T) {
	e := newEnv(t)
	if _, err := e.repo.Upsert(e.userA, []types.Type{typ("t1", "a", 1000)}, 5000); err != nil {
		t.Fatal(err)
	}
	older := typ("t1", "a", 900)
	older.Name = "Antigo"
	ignored, err := e.repo.Upsert(e.userA, []types.Type{older}, 6000)
	if err != nil {
		t.Fatal(err)
	}
	if len(ignored) != 1 || ignored[0] != "t1" {
		t.Fatalf("esperava t1 ignorado, veio %v", ignored)
	}
	got, _ := e.repo.Get(e.userA, "t1")
	if got.Name == "Antigo" {
		t.Fatal("versão mais antiga sobrescreveu a atual")
	}
	newer := typ("t1", "a", 1100)
	newer.Name = "Novo"
	if ignored, err = e.repo.Upsert(e.userA, []types.Type{newer}, 7000); err != nil || len(ignored) != 0 {
		t.Fatalf("versão mais nova deveria gravar: %v %v", ignored, err)
	}
}

func TestDeltaUsaSyncedAtNaoUpdatedAt(t *testing.T) {
	e := newEnv(t)
	// Relógio do cliente atrasado: updated_at muito abaixo do cursor dos outros.
	if _, err := e.repo.Upsert(e.userA, []types.Type{typ("t1", "a", 10)}, 5000); err != nil {
		t.Fatal(err)
	}
	got, err := e.repo.Since(e.userA, 4999)
	if err != nil || len(got) != 1 {
		t.Fatalf("o delta devia trazer o tipo gravado com relógio atrasado: %v %v", got, err)
	}
	if got, _ = e.repo.Since(e.userA, 5001); len(got) != 0 {
		t.Fatalf("cursor à frente não devia trazer nada: %v", got)
	}
}

func TestSlugUnicoEntreVivosEReutilizavelDepoisDeApagar(t *testing.T) {
	e := newEnv(t)
	if _, err := e.repo.Upsert(e.userA, []types.Type{typ("t1", "trilha", 1)}, 100); err != nil {
		t.Fatal(err)
	}
	if _, err := e.repo.Upsert(e.userA, []types.Type{typ("t2", "trilha", 2)}, 200); !errors.Is(err, types.ErrSlugTaken) {
		t.Fatalf("esperava ErrSlugTaken, veio %v", err)
	}
	if _, err := e.repo.Delete(e.userA, "t1", 300); err != nil {
		t.Fatal(err)
	}
	if _, err := e.repo.Upsert(e.userA, []types.Type{typ("t2", "trilha", 3)}, 400); err != nil {
		t.Fatalf("slug de tipo apagado devia poder ser reutilizado: %v", err)
	}
	// Outro usuário pode usar o mesmo slug.
	if _, err := e.repo.Upsert(e.userB, []types.Type{typ("t1", "trilha", 1)}, 500); err != nil {
		t.Fatalf("slug é por usuário: %v", err)
	}
}

func TestTetoDeCinquentaTiposVivos(t *testing.T) {
	e := newEnv(t)
	for i := 0; i < types.MaxTypes; i++ {
		id := fmt.Sprintf("t%d", i)
		if _, err := e.repo.Upsert(e.userA, []types.Type{typ(id, fmt.Sprintf("s%d", i), 1)}, 100); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := e.repo.Upsert(e.userA, []types.Type{typ("extra", "extra", 1)}, 100); !errors.Is(err, types.ErrLimit) {
		t.Fatalf("esperava ErrLimit, veio %v", err)
	}
	// Editar um existente continua valendo no teto.
	up := typ("t0", "s0", 2)
	if _, err := e.repo.Upsert(e.userA, []types.Type{up}, 200); err != nil {
		t.Fatalf("editar no teto devia passar: %v", err)
	}
}

func TestValidacaoDoTipo(t *testing.T) {
	e := newEnv(t)
	cases := map[string]func(*types.Type){
		"ícone fora da lista":   func(x *types.Type) { x.Icon = "🦄" },
		"cor fora da paleta":    func(x *types.Type) { x.Color = "#7df9ff" },
		"nível repetido":        func(x *types.Type) { x.Levels = append(x.Levels, x.Levels[0]) },
		"template grande":       func(x *types.Type) { x.Template = string(make([]byte, types.MaxTemplateBytes+1)) },
		"slug inválido":         func(x *types.Type) { x.Slug = "Tem Espaço" },
		"nome vazio":            func(x *types.Type) { x.Name = "  " },
		"seção protegida vazia": func(x *types.Type) { x.ProtectedSections = []string{" "} },
	}
	for name, mut := range cases {
		x := typ("v1", "valido", 1)
		mut(&x)
		if _, err := e.repo.Upsert(e.userA, []types.Type{x}, 100); !errors.Is(err, types.ErrInvalid) {
			t.Errorf("%s: esperava ErrInvalid, veio %v", name, err)
		}
	}
}

func TestAtribuicaoNivelEZettelInexistente(t *testing.T) {
	e := newEnv(t)
	e.zettel(t, e.userA, "z1")
	if _, err := e.repo.Upsert(e.userA, []types.Type{typ("c", "conteudo", 1)}, 100); err != nil {
		t.Fatal(err)
	}

	skipped, err := e.repo.UpsertAssignments(e.userA, []types.Assignment{
		{ZettelID: "z1", TypeID: "c", Level: "semente", UpdatedAt: 10},
		{ZettelID: "naoexiste", TypeID: "c", Level: "semente", UpdatedAt: 10},
	}, 200)
	if err != nil {
		t.Fatal(err)
	}
	if len(skipped) != 1 || skipped[0] != "naoexiste" {
		t.Fatalf("skipped: %v", skipped)
	}
	a, _ := e.repo.Assignment(e.userA, "z1")
	if a == nil || a.Level != "semente" {
		t.Fatalf("atribuição: %+v", a)
	}

	// Nível inexistente: 400 e nada muda.
	_, err = e.repo.UpsertAssignments(e.userA, []types.Assignment{{ZettelID: "z1", TypeID: "c", Level: "publicado", UpdatedAt: 20}}, 300)
	if !errors.Is(err, types.ErrInvalid) {
		t.Fatalf("esperava ErrInvalid, veio %v", err)
	}
	if a, _ = e.repo.Assignment(e.userA, "z1"); a.Level != "semente" {
		t.Fatal("nível inválido alterou a atribuição")
	}
	// Tipo apagado/inexistente.
	_, err = e.repo.UpsertAssignments(e.userA, []types.Assignment{{ZettelID: "z1", TypeID: "nope", UpdatedAt: 30}}, 400)
	if !errors.Is(err, types.ErrInvalid) {
		t.Fatalf("tipo inexistente devia ser ErrInvalid, veio %v", err)
	}
}

func TestAtribuicaoLWWETombstone(t *testing.T) {
	e := newEnv(t)
	e.zettel(t, e.userA, "z1")
	_, _ = e.repo.Upsert(e.userA, []types.Type{typ("c", "conteudo", 1)}, 100)
	_, _ = e.repo.UpsertAssignments(e.userA, []types.Assignment{{ZettelID: "z1", TypeID: "c", Level: "testado", UpdatedAt: 50}}, 200)
	// Versão mais antiga é ignorada.
	_, _ = e.repo.UpsertAssignments(e.userA, []types.Assignment{{ZettelID: "z1", TypeID: "c", Level: "semente", UpdatedAt: 40}}, 300)
	if a, _ := e.repo.Assignment(e.userA, "z1"); a.Level != "testado" {
		t.Fatalf("LWW falhou: %+v", a)
	}
	// "Sem tipo" = tombstone.
	del := int64(1)
	_, err := e.repo.UpsertAssignments(e.userA, []types.Assignment{{ZettelID: "z1", TypeID: "c", UpdatedAt: 60, DeletedAt: &del}}, 400)
	if err != nil {
		t.Fatal(err)
	}
	if a, _ := e.repo.Assignment(e.userA, "z1"); a != nil {
		t.Fatalf("zettel devia estar sem tipo: %+v", a)
	}
	// O tombstone chega pelo delta.
	got, _ := e.repo.AssignmentsSince(e.userA, 400)
	if len(got) != 1 || got[0].DeletedAt == nil {
		t.Fatalf("delta devia trazer o tombstone: %+v", got)
	}
}

func TestApagarTipoSoltaZettelsSemTocarNeles(t *testing.T) {
	e := newEnv(t)
	for _, id := range []string{"z1", "z2", "z3"} {
		e.zettel(t, e.userA, id)
	}
	_, _ = e.repo.Upsert(e.userA, []types.Type{typ("c", "conteudo", 1), typ("f", "fonte", 1)}, 100)
	_, _ = e.repo.UpsertAssignments(e.userA, []types.Assignment{
		{ZettelID: "z1", TypeID: "c", Level: "semente", UpdatedAt: 10},
		{ZettelID: "z2", TypeID: "c", UpdatedAt: 10},
		{ZettelID: "z3", TypeID: "f", UpdatedAt: 10},
	}, 200)

	released, err := e.repo.Delete(e.userA, "c", 500)
	if err != nil {
		t.Fatal(err)
	}
	if len(released) != 2 {
		t.Fatalf("esperava 2 zettels soltos, veio %v", released)
	}
	for _, id := range []string{"z1", "z2"} {
		if a, _ := e.repo.Assignment(e.userA, id); a != nil {
			t.Errorf("%s devia estar sem tipo", id)
		}
		z, _ := e.zrepo.GetByID(e.userA, id)
		if z == nil || z.UpdatedAt != 1 || z.Body != "corpo" {
			t.Errorf("%s foi alterado ao apagar o tipo: %+v", id, z)
		}
	}
	if a, _ := e.repo.Assignment(e.userA, "z3"); a == nil {
		t.Error("z3 (outro tipo) não devia ser afetado")
	}
	if n, _ := e.repo.CountUsing(e.userA, "f"); n != 1 {
		t.Errorf("CountUsing = %d", n)
	}
	// Tipo apagado não ressuscita por upsert.
	back := typ("c", "conteudo", 9999)
	if ignored, _ := e.repo.Upsert(e.userA, []types.Type{back}, 600); len(ignored) != 1 {
		t.Errorf("tipo apagado não devia ser reescrito: %v", ignored)
	}
	// Apagar de novo = não encontrado.
	if _, err := e.repo.Delete(e.userA, "c", 700); !errors.Is(err, types.ErrNotFound) {
		t.Errorf("esperava ErrNotFound, veio %v", err)
	}
}

func TestIsolamentoEntreUsuarios(t *testing.T) {
	e := newEnv(t)
	_, _ = e.repo.Upsert(e.userA, []types.Type{typ("c", "conteudo", 1)}, 100)
	if _, err := e.repo.Get(e.userB, "c"); !errors.Is(err, types.ErrNotFound) {
		t.Fatalf("outro usuário viu o tipo: %v", err)
	}
	if got, _ := e.repo.Since(e.userB, 0); len(got) != 0 {
		t.Fatalf("delta de outro usuário trouxe tipos: %v", got)
	}
	if _, err := e.repo.Resolve(e.userB, "conteudo"); !errors.Is(err, types.ErrNotFound) {
		t.Fatalf("Resolve vazou entre usuários: %v", err)
	}
}

func TestResolvePorIdEPorSlug(t *testing.T) {
	e := newEnv(t)
	_, _ = e.repo.Upsert(e.userA, []types.Type{typ("abc123", "conteudo", 1)}, 100)
	for _, ref := range []string{"abc123", "conteudo", "CONTEUDO"} {
		got, err := e.repo.Resolve(e.userA, ref)
		if err != nil || got.ID != "abc123" {
			t.Errorf("Resolve(%q) = %v, %v", ref, got, err)
		}
	}
}

func TestCheckLevelChange(t *testing.T) {
	c := typ("c", "conteudo", 1)
	f := types.Type{ID: "f", Slug: "fonte"}
	sem := types.LevelState{Type: &c, Level: "semente"}
	test := types.LevelState{Type: &c, Level: "testado"}
	cons := types.LevelState{Type: &c, Level: "consolidado"}

	if err := types.CheckLevelChange(types.SourceAgent, sem, test); err != nil {
		t.Errorf("agente promove até nível comum: %v", err)
	}
	if err := types.CheckLevelChange(types.SourceAgent, test, cons); !errors.Is(err, types.ErrReservedLevel) {
		t.Errorf("agente não marca user_only: %v", err)
	}
	for name, to := range map[string]types.LevelState{
		"nível": sem, "tipo": {Type: &f}, "remover": {},
	} {
		if err := types.CheckLevelChange(types.SourceAgent, cons, to); !errors.Is(err, types.ErrReservedLevel) {
			t.Errorf("agente não tira de user_only (%s): %v", name, err)
		}
	}
	if err := types.CheckLevelChange(types.SourceAgent, cons, cons); err != nil {
		t.Errorf("sem mudança passa: %v", err)
	}
	if err := types.CheckLevelChange(types.SourceUI, test, cons); err != nil {
		t.Errorf("usuário pode tudo: %v", err)
	}
	if err := types.CheckLevelChange(types.SourceUI, cons, sem); err != nil {
		t.Errorf("usuário rebaixa: %v", err)
	}
}

func TestEffectiveLevelEValidateLevel(t *testing.T) {
	c := typ("c", "conteudo", 1)
	if c.EffectiveLevel("beta") != "" || c.EffectiveLevel("testado") != "testado" {
		t.Error("EffectiveLevel")
	}
	f := types.Type{Slug: "fonte"}
	if err := f.ValidateLevel("x"); !errors.Is(err, types.ErrInvalid) {
		t.Errorf("tipo sem escada recusa nível: %v", err)
	}
	if err := f.ValidateLevel(""); err != nil {
		t.Errorf("tipo sem escada aceita vazio: %v", err)
	}
	if err := c.ValidateLevel("publicado"); !errors.Is(err, types.ErrInvalid) {
		t.Errorf("nível inexistente: %v", err)
	}
}
