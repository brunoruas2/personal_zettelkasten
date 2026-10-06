package drawings_test

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/brunofullstack/zettelkasten/api/internal/auth"
	"github.com/brunofullstack/zettelkasten/api/internal/db"
	"github.com/brunofullstack/zettelkasten/api/internal/drawings"
	"github.com/brunofullstack/zettelkasten/api/internal/images"
	"github.com/brunofullstack/zettelkasten/api/internal/zettel"
	"github.com/go-chi/chi/v5"
	"github.com/golang-jwt/jwt/v5"
)

const jwtSecret = "test-secret"

const goodScene = `{"type":"excalidraw","version":2,"elements":[],"appState":{},"files":{}}`
const goodSVG = `<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><style>@font-face{font-family:X;src:url(data:font/woff2;base64,AAAA)}</style><rect width="10" height="10"/></svg>`

type env struct {
	srv      http.Handler
	repo     *drawings.Repository
	zRepo    *zettel.Repository
	tokenA   string
	tokenB   string
	userAID  string
	quotaPut int64
}

func newEnv(t *testing.T, quota int64) *env {
	t.Helper()
	database, err := db.Open(filepath.Join(t.TempDir(), "t.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { database.Close() })

	authRepo := auth.NewRepository(database)
	a, err := authRepo.CreateUser("alice", "password-a", "member")
	if err != nil {
		t.Fatal(err)
	}
	b, err := authRepo.CreateUser("bob", "password-b", "member")
	if err != nil {
		t.Fatal(err)
	}
	token := func(id string) string {
		tok := jwt.NewWithClaims(jwt.SigningMethodHS256, jwt.MapClaims{
			"sub": id, "role": "member", "exp": time.Now().Add(time.Hour).Unix(),
		})
		s, err := tok.SignedString([]byte(jwtSecret))
		if err != nil {
			t.Fatal(err)
		}
		return s
	}

	repo := drawings.NewRepository(database)
	h := drawings.NewHandler(repo, quota)
	zRepo := zettel.NewRepository(database)
	zHandler := zettel.NewHandler(zRepo, images.NewRepository(database)).WithDrawings(repo)

	r := chi.NewRouter()
	r.Group(func(r chi.Router) {
		r.Use(auth.RequireAuthOrKey(jwtSecret, authRepo))
		r.Mount("/api/zettels", zHandler.Routes())
	})
	r.Group(func(r chi.Router) {
		r.Use(auth.RequireAuth(jwtSecret))
		r.Get("/api/drawings/manifest", h.Manifest)
		r.Put("/api/drawings/{id}", h.Put)
		r.Get("/api/drawings/{id}", h.Get)
		r.Delete("/api/drawings/{id}", h.Delete)
	})

	return &env{srv: r, repo: repo, zRepo: zRepo, tokenA: token(a.ID), tokenB: token(b.ID), userAID: a.ID}
}

func (e *env) do(method, path, token, body string) *httptest.ResponseRecorder {
	req := httptest.NewRequest(method, path, strings.NewReader(body))
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	rec := httptest.NewRecorder()
	e.srv.ServeHTTP(rec, req)
	return rec
}

func putBody(scene, svg string, updatedAt int64) string {
	b, _ := json.Marshal(map[string]any{
		"scene": scene, "svg": svg, "width": 10, "height": 10,
		"created_at": 1000, "updated_at": updatedAt,
	})
	return string(b)
}

func TestPutValidStoresAndGetReturns(t *testing.T) {
	e := newEnv(t, 1<<20)
	rec := e.do("PUT", "/api/drawings/abc123", e.tokenA, putBody(goodScene, goodSVG, 2000))
	if rec.Code != 200 {
		t.Fatalf("put: %d %s", rec.Code, rec.Body.String())
	}
	rec = e.do("GET", "/api/drawings/abc123", e.tokenA, "")
	if rec.Code != 200 {
		t.Fatalf("get: %d", rec.Code)
	}
	var d drawings.Drawing
	if err := json.Unmarshal(rec.Body.Bytes(), &d); err != nil {
		t.Fatal(err)
	}
	if d.Scene != goodScene || d.UpdatedAt != 2000 || d.ByteLen != int64(len(goodScene)+len(goodSVG)) {
		t.Fatalf("unexpected drawing: %+v", d)
	}
}

func TestPutLastWriteWins(t *testing.T) {
	e := newEnv(t, 1<<20)
	e.do("PUT", "/api/drawings/abc", e.tokenA, putBody(goodScene, goodSVG, 2000))

	newer := strings.Replace(goodScene, `"version":2`, `"version":3`, 1)
	if rec := e.do("PUT", "/api/drawings/abc", e.tokenA, putBody(newer, goodSVG, 3000)); !strings.Contains(rec.Body.String(), "stored") {
		t.Fatalf("newer write should be stored: %s", rec.Body.String())
	}
	// Fora de ordem e repetida: ignoradas, resposta de sucesso.
	for _, ts := range []int64{2500, 3000} {
		rec := e.do("PUT", "/api/drawings/abc", e.tokenA, putBody(goodScene, goodSVG, ts))
		if rec.Code != 200 || !strings.Contains(rec.Body.String(), "ignored") {
			t.Fatalf("ts %d should be ignored: %d %s", ts, rec.Code, rec.Body.String())
		}
	}
	d, _ := e.repo.Get(e.userAID, "abc")
	if d.UpdatedAt != 3000 || d.Scene != newer {
		t.Fatalf("stored drawing regressed: %+v", d)
	}
}

func TestUsersSeeOnlyTheirOwn(t *testing.T) {
	e := newEnv(t, 1<<20)
	e.do("PUT", "/api/drawings/abc", e.tokenA, putBody(goodScene, goodSVG, 2000))
	if rec := e.do("GET", "/api/drawings/abc", e.tokenB, ""); rec.Code != 404 {
		t.Fatalf("other user must get 404, got %d", rec.Code)
	}
	// Mesmo id, outro usuário: coexistem.
	if rec := e.do("PUT", "/api/drawings/abc", e.tokenB, putBody(goodScene, goodSVG, 2000)); rec.Code != 200 {
		t.Fatalf("same id other user: %d", rec.Code)
	}
	rec := e.do("GET", "/api/drawings/manifest", e.tokenB, "")
	var m struct {
		Drawings []drawings.ManifestEntry `json:"drawings"`
	}
	json.Unmarshal(rec.Body.Bytes(), &m)
	if len(m.Drawings) != 1 {
		t.Fatalf("manifest should list only own drawing: %+v", m)
	}
}

func TestRejectsInvalidInput(t *testing.T) {
	e := newEnv(t, 1<<20)
	cases := map[string]string{
		"scene not excalidraw": putBody(`{"type":"other"}`, goodSVG, 2000),
		"scene not json":       putBody(`nope`, goodSVG, 2000),
		"svg with script":      putBody(goodScene, `<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>`, 2000),
		"svg external href":    putBody(goodScene, `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"><image href="https://evil.example/x.png"/></svg>`, 2000),
		"svg onload":           putBody(goodScene, `<svg xmlns="http://www.w3.org/2000/svg" onload="x()"></svg>`, 2000),
		"svg external css":     putBody(goodScene, `<svg xmlns="http://www.w3.org/2000/svg"><style>@import url(https://x/y.css);</style></svg>`, 2000),
		"svg foreignObject":    putBody(goodScene, `<svg xmlns="http://www.w3.org/2000/svg"><foreignObject/></svg>`, 2000),
		"svg not xml":          putBody(goodScene, `<svg><rect></svg>`, 2000),
		"svg wrong root":       putBody(goodScene, `<html/>`, 2000),
		"missing updated_at":   putBody(goodScene, goodSVG, 0),
	}
	for name, body := range cases {
		if rec := e.do("PUT", "/api/drawings/abc", e.tokenA, body); rec.Code != 400 {
			t.Errorf("%s: want 400, got %d %s", name, rec.Code, rec.Body.String())
		}
	}
	if rec := e.do("PUT", "/api/drawings/bad%20id", e.tokenA, putBody(goodScene, goodSVG, 2000)); rec.Code != 400 {
		t.Errorf("bad id: want 400, got %d", rec.Code)
	}
	if d, _ := e.repo.Get(e.userAID, "abc"); d != nil {
		t.Fatal("nothing must be stored after rejected writes")
	}
}

func TestRejectsOverSizeLimit(t *testing.T) {
	e := newEnv(t, 100<<20)
	big := `<svg xmlns="http://www.w3.org/2000/svg"><desc>` + strings.Repeat("a", int(drawings.MaxDrawingBytes)) + `</desc></svg>`
	if rec := e.do("PUT", "/api/drawings/abc", e.tokenA, putBody(goodScene, big, 2000)); rec.Code != 413 {
		t.Fatalf("want 413, got %d", rec.Code)
	}
}

func TestQuota(t *testing.T) {
	size := int64(len(goodScene) + len(goodSVG))
	e := newEnv(t, size+size/2) // cabe um, não cabe dois
	if rec := e.do("PUT", "/api/drawings/one", e.tokenA, putBody(goodScene, goodSVG, 2000)); rec.Code != 200 {
		t.Fatalf("first: %d", rec.Code)
	}
	if rec := e.do("PUT", "/api/drawings/two", e.tokenA, putBody(goodScene, goodSVG, 2000)); rec.Code != 413 {
		t.Fatalf("second should exceed quota, got %d", rec.Code)
	}
	// Regravar o mesmo id substitui, não soma.
	if rec := e.do("PUT", "/api/drawings/one", e.tokenA, putBody(goodScene, goodSVG, 3000)); rec.Code != 200 {
		t.Fatalf("rewrite should fit: %d", rec.Code)
	}
}

func TestRefsAndOrphanGC(t *testing.T) {
	e := newEnv(t, 1<<20)
	e.do("PUT", "/api/drawings/dr1", e.tokenA, putBody(goodScene, goodSVG, 2000))

	create := func(body string) string {
		b, _ := json.Marshal(map[string]any{"title": "z", "body": body, "tags": []string{}})
		rec := e.do("POST", "/api/zettels", e.tokenA, string(b))
		if rec.Code != 200 && rec.Code != 201 {
			t.Fatalf("create zettel: %d %s", rec.Code, rec.Body.String())
		}
		var z struct {
			ID string `json:"id"`
		}
		json.Unmarshal(rec.Body.Bytes(), &z)
		return z.ID
	}
	orphaned := func() bool {
		// Purga com corte no futuro: só some se estiver marcado como órfão.
		n, err := e.repo.PurgeOrphans(time.Now().UnixMilli() + 1000)
		if err != nil {
			t.Fatal(err)
		}
		return n > 0
	}

	zid := create("veja ![](zk:draw/dr1)")
	if orphaned() {
		t.Fatal("referenced drawing must not be purged")
	}

	// Remover a referência marca como órfão, mas só o expurgo com carência apaga.
	upd, _ := json.Marshal(map[string]any{"title": "z", "body": "sem desenho", "tags": []string{}})
	if rec := e.do("PUT", "/api/zettels/"+zid, e.tokenA, string(upd)); rec.Code != 200 {
		t.Fatalf("update zettel: %d %s", rec.Code, rec.Body.String())
	}
	if n, _ := e.repo.PurgeOrphans(time.Now().UnixMilli() - drawings.OrphanGraceMillis); n != 0 {
		t.Fatal("drawing inside the grace period must survive")
	}
	if d, _ := e.repo.Get(e.userAID, "dr1"); d == nil {
		t.Fatal("drawing must still exist during grace")
	}

	// Voltar a referenciar limpa a marca.
	back, _ := json.Marshal(map[string]any{"title": "z", "body": "volta ![](zk:draw/dr1)", "tags": []string{}})
	e.do("PUT", "/api/zettels/"+zid, e.tokenA, string(back))
	if orphaned() {
		t.Fatal("re-referenced drawing must not be purged")
	}

	// Sem referência e passada a carência: apagado.
	e.do("DELETE", "/api/zettels/"+zid, e.tokenA, "")
	if !orphaned() {
		t.Fatal("orphan past the grace period must be purged")
	}
	if d, _ := e.repo.Get(e.userAID, "dr1"); d != nil {
		t.Fatal("drawing must be gone")
	}
}

func TestAPIKeyGetsNoAccess(t *testing.T) {
	e := newEnv(t, 1<<20)
	// Sem JWT válido a rota responde 401 (a chave zk_ só passa na allowlist de /api/zettels).
	if rec := e.do("GET", "/api/drawings/manifest", "zk_"+strings.Repeat("ab", 32), ""); rec.Code != 401 {
		t.Fatalf("api key must get 401, got %d", rec.Code)
	}
}
