package zettel_test

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/brunofullstack/zettelkasten/api/internal/auth"
	"github.com/brunofullstack/zettelkasten/api/internal/db"
	"github.com/brunofullstack/zettelkasten/api/internal/images"
	"github.com/brunofullstack/zettelkasten/api/internal/types"
	"github.com/brunofullstack/zettelkasten/api/internal/zettel"
	"github.com/go-chi/chi/v5"
	"github.com/golang-jwt/jwt/v5"
)

const conteudoTemplate = "## Captura\n\n## Minha síntese\n\n## Testes\n"

type typedEnv struct {
	*svcEnv
	trepo *types.Repository
	agent context.Context
}

func newTyped(t *testing.T) *typedEnv {
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
	trepo := types.NewRepository(database)
	svc := zettel.NewService(zettel.NewRepository(database), images.NewRepository(database)).WithTypes(trepo).WithNotifier(n)
	base := &svcEnv{svc: svc, notes: n, user: u.ID, ctx: context.Background()}
	e := &typedEnv{svcEnv: base, trepo: trepo, agent: context.WithValue(context.Background(), auth.SourceKey, auth.SourceAgent)}

	seed := []types.Type{
		{
			ID: "tc", Name: "Conteúdo", Slug: "conteudo", Icon: "📘", Color: "#a78bfa", Template: conteudoTemplate,
			ProtectedSections: []string{"Minha síntese"}, CountsProgress: true, UpdatedAt: 1,
			Levels: []types.Level{
				{Key: "semente", Label: "Semente", Emoji: "🤖"},
				{Key: "testado", Label: "Testado", Emoji: "💾"},
				{Key: "consolidado", Label: "Consolidado", Emoji: "🧠", UserOnly: true},
			},
		},
		{ID: "tf", Name: "Fonte", Slug: "fonte", Icon: "📚", Color: "#60a5fa", UpdatedAt: 1},
	}
	if _, err := trepo.Upsert(u.ID, seed, 100); err != nil {
		t.Fatal(err)
	}
	return e
}

// zettel de conteúdo com síntese escrita pelo usuário.
func (e *typedEnv) conteudo(t *testing.T) string {
	t.Helper()
	z, err := e.svc.Create(e.ctx, e.user, zettel.CreateInput{
		Title: "Recursão", Type: "conteudo", Level: "semente",
		Body: "## Captura\numa função que chama a si mesma\n\n## Minha síntese\n- chama a si mesma\n\n## Testes\n",
	})
	if err != nil {
		t.Fatal(err)
	}
	return z.ID
}

func TestAgenteNaoEditaSecaoProtegida(t *testing.T) {
	e := newTyped(t)
	id := e.conteudo(t)

	// Trecho dentro da síntese.
	_, err := e.svc.Patch(e.agent, e.user, id, "- chama a si mesma", "- outra coisa")
	if !errors.Is(err, zettel.ErrForbidden) {
		t.Fatalf("patch na síntese: esperava ErrForbidden, veio %v", err)
	}
	// Corpo inteiro com a síntese alterada.
	_, err = e.svc.Update(e.agent, e.user, id, zettel.UpdateInput{
		Title: "Recursão", Tags: []string{},
		Body: "## Captura\nx\n\n## Minha síntese\n- reescrita\n\n## Testes\n",
	})
	if !errors.Is(err, zettel.ErrForbidden) {
		t.Fatalf("update na síntese: esperava ErrForbidden, veio %v", err)
	}
	if !strings.Contains(e.body(t, id), "- chama a si mesma") {
		t.Fatal("a síntese foi alterada apesar da recusa")
	}

	// Outra seção: passa.
	if _, err := e.svc.Patch(e.agent, e.user, id, "uma função que chama a si mesma", "uma função que se invoca"); err != nil {
		t.Fatalf("edição da Captura devia passar: %v", err)
	}
	// Corpo inteiro preservando a síntese: passa.
	_, err = e.svc.Update(e.agent, e.user, id, zettel.UpdateInput{
		Title: "Recursão", Tags: []string{},
		Body: "## Captura\nnova captura\n\n## Minha síntese\n- chama a si mesma\n\n## Testes\n[[Teste — Recursão]]",
	})
	if err != nil {
		t.Fatalf("update preservando a síntese devia passar: %v", err)
	}
	// SetTags (mesmo corpo) passa.
	if _, err := e.svc.SetTags(e.agent, e.user, id, []string{"estudo"}, nil); err != nil {
		t.Fatalf("set_tags devia passar: %v", err)
	}
}

func TestUsuarioEditaASintese(t *testing.T) {
	e := newTyped(t)
	id := e.conteudo(t)
	if _, err := e.svc.Patch(e.ctx, e.user, id, "- chama a si mesma", "- minha versão"); err != nil {
		t.Fatalf("usuário (ui) devia poder editar: %v", err)
	}
}

func TestZettelSemTipoFicaLivre(t *testing.T) {
	e := newTyped(t)
	id := e.mk(t, "Livre", "## Minha síntese\nx\n")
	if _, err := e.svc.Patch(e.agent, e.user, id, "x", "y"); err != nil {
		t.Fatalf("sem tipo, o agente edita normalmente: %v", err)
	}
}

func TestZettelDeTipoSemSecaoProtegidaFicaLivre(t *testing.T) {
	e := newTyped(t)
	z, err := e.svc.Create(e.ctx, e.user, zettel.CreateInput{Title: "Livro", Type: "fonte", Body: "## Minha síntese\nx"})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := e.svc.Patch(e.agent, e.user, z.ID, "x", "y"); err != nil {
		t.Fatalf("tipo sem seção protegida não restringe: %v", err)
	}
}

func TestCriarComTipoAplicaTemplate(t *testing.T) {
	e := newTyped(t)
	z, err := e.svc.Create(e.agent, e.user, zettel.CreateInput{Title: "Índices", Type: "conteudo"})
	if err != nil {
		t.Fatal(err)
	}
	if z.Body != conteudoTemplate {
		t.Fatalf("corpo = %q", z.Body)
	}
	info, _ := e.svc.TypeOf(e.user, z.ID)
	if info.Type == nil || info.Type.Slug != "conteudo" {
		t.Fatalf("tipo não atribuído: %+v", info)
	}
	// Por id também.
	if _, err := e.svc.Create(e.agent, e.user, zettel.CreateInput{Title: "JOIN", Type: "tc"}); err != nil {
		t.Fatalf("por id: %v", err)
	}
}

func TestCriarAgenteComSinteseOuNivelReservado(t *testing.T) {
	e := newTyped(t)
	_, err := e.svc.Create(e.agent, e.user, zettel.CreateInput{
		Title: "X", Type: "conteudo", Body: "## Minha síntese\ntexto do agente",
	})
	if !errors.Is(err, zettel.ErrForbidden) {
		t.Fatalf("síntese preenchida na criação: %v", err)
	}
	_, err = e.svc.Create(e.agent, e.user, zettel.CreateInput{Title: "Y", Type: "conteudo", Level: "consolidado"})
	if !errors.Is(err, zettel.ErrForbidden) {
		t.Fatalf("nível reservado na criação: %v", err)
	}
	// Nada foi criado.
	if rs, _ := e.svc.ListRecent(e.user, 10); len(rs) != 0 {
		t.Fatalf("zettel criado apesar da recusa: %d", len(rs))
	}
	// Tipo desconhecido lista os slugs.
	_, err = e.svc.Create(e.agent, e.user, zettel.CreateInput{Title: "Z", Type: "xyz"})
	if !errors.Is(err, zettel.ErrInvalid) || !strings.Contains(err.Error(), "conteudo") {
		t.Fatalf("tipo desconhecido: %v", err)
	}
}

func TestSetTypeRegrasDeNivel(t *testing.T) {
	e := newTyped(t)
	id := e.conteudo(t)

	// Agente promove até um nível comum.
	if _, err := e.svc.SetType(e.agent, e.user, id, "conteudo", "testado"); err != nil {
		t.Fatalf("testado: %v", err)
	}
	// Mas não marca o reservado.
	if _, err := e.svc.SetType(e.agent, e.user, id, "conteudo", "consolidado"); !errors.Is(err, zettel.ErrForbidden) {
		t.Fatalf("consolidado pelo agente: %v", err)
	}
	// Nível inexistente: ErrInvalid listando os válidos.
	if _, err := e.svc.SetType(e.agent, e.user, id, "conteudo", "publicado"); !errors.Is(err, zettel.ErrInvalid) || !strings.Contains(err.Error(), "semente") {
		t.Fatalf("nível inexistente: %v", err)
	}
	// Usuário consolida.
	if _, err := e.svc.SetType(e.ctx, e.user, id, "conteudo", "consolidado"); err != nil {
		t.Fatalf("usuário consolida: %v", err)
	}
	// Agente não rebaixa, não troca de tipo, não remove o tipo.
	for name, args := range map[string][2]string{"rebaixar": {"conteudo", "semente"}, "trocar": {"fonte", ""}, "remover": {"", ""}} {
		if _, err := e.svc.SetType(e.agent, e.user, id, args[0], args[1]); !errors.Is(err, zettel.ErrForbidden) {
			t.Errorf("%s: esperava ErrForbidden, veio %v", name, err)
		}
	}
	info, _ := e.svc.TypeOf(e.user, id)
	if info.Level != "consolidado" {
		t.Fatalf("o nível do usuário foi alterado: %+v", info)
	}
	// O usuário rebaixa e remove.
	if _, err := e.svc.SetType(e.ctx, e.user, id, "conteudo", "semente"); err != nil {
		t.Fatal(err)
	}
	if _, err := e.svc.SetType(e.ctx, e.user, id, "", ""); err != nil {
		t.Fatal(err)
	}
	if info, _ = e.svc.TypeOf(e.user, id); info.Type != nil {
		t.Fatalf("devia estar sem tipo: %+v", info)
	}
}

func TestSetTypeTrocaDeTipoLimpaNivelEMantemNoMesmoTipo(t *testing.T) {
	e := newTyped(t)
	id := e.conteudo(t)
	e.svc.SetType(e.agent, e.user, id, "conteudo", "testado") //nolint:errcheck
	// Mesmo tipo, sem nível: mantém.
	if _, err := e.svc.SetType(e.agent, e.user, id, "conteudo", ""); err != nil {
		t.Fatal(err)
	}
	if info, _ := e.svc.TypeOf(e.user, id); info.Level != "testado" {
		t.Fatalf("devia manter o nível: %+v", info)
	}
	// Outro tipo: limpa.
	if _, err := e.svc.SetType(e.agent, e.user, id, "fonte", ""); err != nil {
		t.Fatal(err)
	}
	if info, _ := e.svc.TypeOf(e.user, id); info.Type.Slug != "fonte" || info.Level != "" {
		t.Fatalf("troca devia limpar o nível: %+v", info)
	}
	// Tipo sem escada recusa nível.
	if _, err := e.svc.SetType(e.agent, e.user, id, "fonte", "x"); !errors.Is(err, zettel.ErrInvalid) {
		t.Fatalf("tipo sem níveis: %v", err)
	}
}

func TestSetTypeNaoTocaNoZettelENotificaComoType(t *testing.T) {
	e := newTyped(t)
	id := e.conteudo(t)
	before, _ := e.svc.Get(e.user, id)
	e.notes.events = nil
	if _, err := e.svc.SetType(e.agent, e.user, id, "conteudo", "testado"); err != nil {
		t.Fatal(err)
	}
	after, _ := e.svc.Get(e.user, id)
	if after.UpdatedAt != before.UpdatedAt || after.Body != before.Body {
		t.Fatalf("SetType alterou o zettel: %d -> %d", before.UpdatedAt, after.UpdatedAt)
	}
	if len(e.notes.events) != 1 || e.notes.events[0].Kind != "type" || e.notes.events[0].Source != auth.SourceAgent || e.notes.events[0].IDs[0] != id {
		t.Fatalf("eventos: %+v", e.notes.events)
	}
}

func TestFiltrosPorTipoENivel(t *testing.T) {
	e := newTyped(t)
	a := e.conteudo(t) // semente
	b, _ := e.svc.Create(e.ctx, e.user, zettel.CreateInput{Title: "JOIN", Type: "conteudo", Level: "testado", Body: "recursão e join"})
	f, _ := e.svc.Create(e.ctx, e.user, zettel.CreateInput{Title: "Livro", Type: "fonte", Body: "recursão no livro"})
	e.mk(t, "Livre", "recursão solta")

	rec, err := e.svc.ListRecentBy(e.user, 10, zettel.TypeRef{Type: "conteudo"})
	if err != nil || len(rec) != 2 {
		t.Fatalf("conteudo: %d %v", len(rec), err)
	}
	rec, _ = e.svc.ListRecentBy(e.user, 10, zettel.TypeRef{Type: "conteudo", Level: "testado"})
	if len(rec) != 1 || rec[0].ID != b.ID {
		t.Fatalf("conteudo+testado: %+v", rec)
	}
	rec, _ = e.svc.ListRecentBy(e.user, 10, zettel.TypeRef{Level: "semente"})
	if len(rec) != 1 || rec[0].ID != a {
		t.Fatalf("só nível: %+v", rec)
	}
	// Busca FTS filtrada.
	res, err := e.svc.SearchBy(e.user, "recursão", 10, zettel.TypeRef{Type: "fonte"})
	if err != nil || len(res) != 1 || res[0].ID != f.ID {
		t.Fatalf("busca fonte: %+v %v", res, err)
	}
	res, _ = e.svc.SearchBy(e.user, "recursão", 10, zettel.TypeRef{})
	if len(res) != 4 {
		t.Fatalf("busca sem filtro devia trazer 4, trouxe %d", len(res))
	}
	// Texto vazio + filtro lista os do tipo.
	res, _ = e.svc.SearchBy(e.user, "", 10, zettel.TypeRef{Type: "conteudo"})
	if len(res) != 2 {
		t.Fatalf("vazio+filtro: %d", len(res))
	}
	// Listagem REST.
	all, _ := e.svc.ListBy(e.user, 0, "", zettel.TypeRef{Type: "fonte"})
	if len(all) != 1 || all[0].ID != f.ID {
		t.Fatalf("ListBy: %+v", all)
	}
	// Tipo desconhecido = ErrInvalid.
	if _, err := e.svc.ListBy(e.user, 0, "", zettel.TypeRef{Type: "nada"}); !errors.Is(err, zettel.ErrInvalid) {
		t.Fatalf("tipo desconhecido: %v", err)
	}
	// Zettel apagado some do filtro e solta a atribuição.
	if err := e.svc.Delete(e.ctx, e.user, b.ID); err != nil {
		t.Fatal(err)
	}
	if rec, _ = e.svc.ListRecentBy(e.user, 10, zettel.TypeRef{Type: "conteudo"}); len(rec) != 1 {
		t.Fatalf("apagado ainda aparece: %d", len(rec))
	}
	if as, _ := e.trepo.AssignmentsSince(e.user, 0); func() bool {
		for _, a := range as {
			if a.ZettelID == b.ID && a.DeletedAt != nil {
				return true
			}
		}
		return false
	}() == false {
		t.Fatal("a atribuição do zettel apagado devia virar tombstone")
	}
}

// --- HTTP: a mesma regra pela API de chave e pelo JWT ---

const httpSecret = "test-secret"

func TestHTTPChaveRecebe403NaSecaoProtegidaEJWTPassa(t *testing.T) {
	database, err := db.Open(filepath.Join(t.TempDir(), "t.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { database.Close() })
	ar := auth.NewRepository(database)
	u, _ := ar.CreateUser("alice", "password-a", "member")
	key := "zk_" + strings.Repeat("ab", 32)
	sum := sha256.Sum256([]byte(key))
	if err := ar.SetAPIKey(u.ID, hex.EncodeToString(sum[:])); err != nil {
		t.Fatal(err)
	}
	tok, _ := jwt.NewWithClaims(jwt.SigningMethodHS256, jwt.MapClaims{
		"sub": u.ID, "role": "member", "exp": time.Now().Add(time.Hour).Unix(),
	}).SignedString([]byte(httpSecret))

	trepo := types.NewRepository(database)
	svc := zettel.NewService(zettel.NewRepository(database), images.NewRepository(database)).WithTypes(trepo)
	th := types.NewHandler(trepo)
	r := chi.NewRouter()
	r.Group(func(r chi.Router) {
		r.Use(auth.RequireAuthOrKey(httpSecret, ar))
		r.Mount("/api/zettels", zettel.NewHandlerWithService(svc).Routes())
	})
	r.Group(func(r chi.Router) {
		r.Use(auth.RequireAuth(httpSecret))
		r.Get("/api/types", th.List)
		r.Put("/api/types", th.Put)
		r.Get("/api/type-assignments", th.ListAssignments)
		r.Put("/api/type-assignments", th.PutAssignments)
	})

	if _, err := trepo.Upsert(u.ID, []types.Type{{
		ID: "tc", Name: "Conteúdo", Slug: "conteudo", Icon: "📘", Color: "#a78bfa",
		ProtectedSections: []string{"Minha síntese"}, UpdatedAt: 1,
	}}, 10); err != nil {
		t.Fatal(err)
	}
	z, err := svc.Create(context.Background(), u.ID, zettel.CreateInput{
		Title: "Recursão", Type: "conteudo", Body: "## Minha síntese\noriginal",
	})
	if err != nil {
		t.Fatal(err)
	}

	do := func(method, path, body string, hdr map[string]string) *httptest.ResponseRecorder {
		req := httptest.NewRequest(method, path, bytes.NewBufferString(body))
		req.Header.Set("Content-Type", "application/json")
		for k, v := range hdr {
			req.Header.Set(k, v)
		}
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)
		return w
	}
	put := `{"title":"Recursão","body":"## Minha síntese\nreescrita","tags":[]}`
	keyHdr := map[string]string{"X-API-Key": key}
	jwtHdr := map[string]string{"Authorization": "Bearer " + tok}

	if w := do("PUT", "/api/zettels/"+z.ID, put, keyHdr); w.Code != http.StatusForbidden {
		t.Fatalf("PUT por chave na seção protegida: %d %s", w.Code, w.Body)
	}
	if w := do("PUT", "/api/zettels/"+z.ID, put, jwtHdr); w.Code != http.StatusOK {
		t.Fatalf("PUT por JWT: %d %s", w.Code, w.Body)
	}

	// Rotas de tipo: chave = 401, JWT = 200.
	for _, route := range [][2]string{{"GET", "/api/types"}, {"PUT", "/api/types"}, {"GET", "/api/type-assignments"}, {"PUT", "/api/type-assignments"}} {
		if w := do(route[0], route[1], `{}`, keyHdr); w.Code != http.StatusUnauthorized {
			t.Errorf("%s %s com chave: %d (esperava 401)", route[0], route[1], w.Code)
		}
	}
	if w := do("GET", "/api/types", "", jwtHdr); w.Code != http.StatusOK {
		t.Fatalf("GET /api/types por JWT: %d", w.Code)
	}
	// Filtros pela REST.
	w := do("GET", "/api/zettels?type=conteudo", "", jwtHdr)
	var got []map[string]any
	json.Unmarshal(w.Body.Bytes(), &got) //nolint:errcheck
	if w.Code != http.StatusOK || len(got) != 1 {
		t.Fatalf("GET ?type=conteudo: %d %s", w.Code, w.Body)
	}
	if w := do("GET", "/api/zettels?type=nada", "", jwtHdr); w.Code != http.StatusBadRequest {
		t.Fatalf("tipo desconhecido devia ser 400: %d", w.Code)
	}
	// Atribuição com nível inexistente = 400.
	bad := `{"assignments":[{"zettel_id":"` + z.ID + `","type_id":"tc","level":"publicado","updated_at":5}]}`
	if w := do("PUT", "/api/type-assignments", bad, jwtHdr); w.Code != http.StatusBadRequest {
		t.Fatalf("nível inválido: %d %s", w.Code, w.Body)
	}
}
