package auth_test

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/brunofullstack/zettelkasten/api/internal/auth"
	"github.com/brunofullstack/zettelkasten/api/internal/db"
	"github.com/brunofullstack/zettelkasten/api/internal/images"
	"github.com/brunofullstack/zettelkasten/api/internal/models"
	"github.com/brunofullstack/zettelkasten/api/internal/zettel"
	"github.com/go-chi/chi/v5"
	"github.com/golang-jwt/jwt/v5"
)

const jwtSecret = "test-secret"

type env struct {
	srv      http.Handler
	authRepo *auth.Repository
	zRepo    *zettel.Repository
	userA    *models.User
	userB    *models.User
	keyA     string
	tokenA   string
}

func newEnv(t *testing.T) *env {
	t.Helper()
	database, err := db.Open(filepath.Join(t.TempDir(), "t.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { database.Close() })

	authRepo := auth.NewRepository(database)
	zRepo := zettel.NewRepository(database)
	zHandler := zettel.NewHandler(zRepo, images.NewRepository(database))

	a, err := authRepo.CreateUser("alice", "password-a", "member")
	if err != nil {
		t.Fatal(err)
	}
	b, err := authRepo.CreateUser("bob", "password-b", "member")
	if err != nil {
		t.Fatal(err)
	}

	keyA := "zk_" + strings.Repeat("ab", 32)
	if err := authRepo.SetAPIKey(a.ID, sha(keyA)); err != nil {
		t.Fatal(err)
	}

	tok := jwt.NewWithClaims(jwt.SigningMethodHS256, jwt.MapClaims{
		"sub": a.ID, "role": "member", "exp": time.Now().Add(time.Hour).Unix(),
	})
	tokenA, err := tok.SignedString([]byte(jwtSecret))
	if err != nil {
		t.Fatal(err)
	}

	r := chi.NewRouter()
	r.Group(func(r chi.Router) {
		r.Use(auth.RequireAuthOrKey(jwtSecret, authRepo))
		r.Mount("/api/zettels", zHandler.Routes())
	})
	r.Group(func(r chi.Router) {
		r.Use(auth.RequireAuth(jwtSecret))
		r.Get("/api/images/x", func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(200) })
		r.Get("/api/auth/settings", func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(200) })
	})

	return &env{srv: r, authRepo: authRepo, zRepo: zRepo, userA: a, userB: b, keyA: keyA, tokenA: tokenA}
}

func sha(s string) string {
	sum := sha256.Sum256([]byte(s))
	return hex.EncodeToString(sum[:])
}

func (e *env) do(method, path, body string, hdr map[string]string) *httptest.ResponseRecorder {
	req := httptest.NewRequest(method, path, strings.NewReader(body))
	for k, v := range hdr {
		req.Header.Set(k, v)
	}
	w := httptest.NewRecorder()
	e.srv.ServeHTTP(w, req)
	return w
}

func (e *env) seed(t *testing.T, userID, id, title, body string) {
	t.Helper()
	now := time.Now().UnixMilli()
	if err := e.zRepo.Create(&models.Zettel{
		ID: id, UserID: userID, Title: title, Body: body, Tags: []string{}, CreatedAt: now, UpdatedAt: now,
	}); err != nil {
		t.Fatal(err)
	}
}

func bearer(k string) map[string]string { return map[string]string{"Authorization": "Bearer " + k} }

func TestAPIKeyAuthentication(t *testing.T) {
	e := newEnv(t)
	e.seed(t, e.userA.ID, "z1", "um", "corpo")

	cases := []struct {
		name string
		path string
		hdr  map[string]string
		want int
	}{
		{"bearer key list", "/api/zettels", bearer(e.keyA), 200},
		{"x-api-key get", "/api/zettels/z1", map[string]string{"X-API-Key": e.keyA}, 200},
		{"unknown key", "/api/zettels", bearer("zk_" + strings.Repeat("00", 32)), 401},
		{"malformed x-api-key", "/api/zettels", map[string]string{"X-API-Key": "nope"}, 401},
		{"key in query string only", "/api/zettels?key=" + e.keyA, nil, 401},
		{"api_key in query string only", "/api/zettels?api_key=" + e.keyA, nil, 401},
		{"jwt unchanged", "/api/zettels", bearer(e.tokenA), 200},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			if got := e.do("GET", c.path, "", c.hdr).Code; got != c.want {
				t.Fatalf("got %d want %d", got, c.want)
			}
		})
	}
}

func TestAPIKeyScope(t *testing.T) {
	e := newEnv(t)
	e.seed(t, e.userA.ID, "z1", "um", "corpo")
	h := bearer(e.keyA)

	forbidden := []struct{ method, path string }{
		{"DELETE", "/api/zettels/z1"},
		{"GET", "/api/zettels/z1/backlinks"},
		{"POST", "/api/zettels/rebuild-links"},
		{"PUT", "/api/zettels"},
	}
	for _, c := range forbidden {
		if got := e.do(c.method, c.path, `{"title":"x"}`, h).Code; got != 403 {
			t.Errorf("%s %s: got %d want 403", c.method, c.path, got)
		}
	}
	if z, _ := e.zRepo.GetByID(e.userA.ID, "z1"); z == nil {
		t.Fatal("zettel must survive forbidden DELETE")
	}

	for _, p := range []string{"/api/images/x", "/api/auth/settings"} {
		if got := e.do("GET", p, "", h).Code; got != 401 {
			t.Errorf("key on %s: got %d want 401", p, got)
		}
	}
}

func TestAPIKeyCreate(t *testing.T) {
	e := newEnv(t)
	h := bearer(e.keyA)

	// user_id no corpo é ignorado pelo handler — o dono é sempre quem a chave resolve.
	w := e.do("POST", "/api/zettels", `{"title":"novo via chave","body":"corpo","tags":["a"],"user_id":"`+e.userB.ID+`"}`, h)
	if w.Code != http.StatusCreated {
		t.Fatalf("got %d want 201: %s", w.Code, w.Body)
	}
	var got models.Zettel
	if err := json.Unmarshal(w.Body.Bytes(), &got); err != nil {
		t.Fatal(err)
	}
	if got.Title != "novo via chave" {
		t.Fatalf("unexpected title: %+v", got)
	}

	z, err := e.zRepo.GetByID(e.userA.ID, got.ID)
	if err != nil || z == nil {
		t.Fatalf("created zettel not found under owner: %v", err)
	}
	if zb, _ := e.zRepo.GetByID(e.userB.ID, got.ID); zb != nil {
		t.Fatalf("created zettel leaked to another user: %+v", zb)
	}
}

func TestAPIKeyIsolation(t *testing.T) {
	e := newEnv(t)
	e.seed(t, e.userB.ID, "zb", "de bob", "original")

	w := e.do("PUT", "/api/zettels/zb", `{"title":"hack","body":"x"}`, bearer(e.keyA))
	if w.Code != 404 {
		t.Fatalf("got %d want 404", w.Code)
	}
	z, _ := e.zRepo.GetByID(e.userB.ID, "zb")
	if z.Title != "de bob" || z.Body != "original" {
		t.Fatalf("bob's zettel changed: %+v", z)
	}
	if w := e.do("GET", "/api/zettels/zb", "", bearer(e.keyA)); w.Code != 404 {
		t.Fatalf("read of other user's zettel: got %d want 404", w.Code)
	}
}

func TestAPIKeyPutSideEffects(t *testing.T) {
	e := newEnv(t)
	e.seed(t, e.userA.ID, "alvo", "alvo", "x")
	e.seed(t, e.userA.ID, "src", "fonte", "antigo")
	before, _ := e.zRepo.GetByID(e.userA.ID, "src")
	time.Sleep(5 * time.Millisecond)

	w := e.do("PUT", "/api/zettels/src", `{"title":"fonte","body":"veja [[alvo]] palavraunica","tags":["t"]}`, bearer(e.keyA))
	if w.Code != 200 {
		t.Fatalf("got %d: %s", w.Code, w.Body)
	}
	var got models.Zettel
	if err := json.Unmarshal(w.Body.Bytes(), &got); err != nil {
		t.Fatal(err)
	}
	if got.UpdatedAt <= before.UpdatedAt {
		t.Errorf("updated_at not advanced: %d <= %d", got.UpdatedAt, before.UpdatedAt)
	}

	links, _ := e.zRepo.GetAllLinks(e.userA.ID)
	found := false
	for _, l := range links {
		if l.SourceID == "src" && l.TargetID == "alvo" {
			found = true
		}
	}
	if !found {
		t.Errorf("link src->alvo missing: %+v", links)
	}

	res, _ := e.zRepo.List(e.userA.ID, 0, "palavraunica")
	if len(res) != 1 || res[0].ID != "src" {
		t.Errorf("FTS did not index new body: %+v", res)
	}

	if w := e.do("PUT", "/api/zettels/src", `{not json`, bearer(e.keyA)); w.Code != 400 {
		t.Errorf("malformed body: got %d want 400", w.Code)
	}
}

func TestAPIKeyRevokeAndRegenerate(t *testing.T) {
	e := newEnv(t)
	if e.do("GET", "/api/zettels", "", bearer(e.keyA)).Code != 200 {
		t.Fatal("key should work")
	}
	newKey := "zk_" + strings.Repeat("cd", 32)
	if err := e.authRepo.SetAPIKey(e.userA.ID, sha(newKey)); err != nil {
		t.Fatal(err)
	}
	if got := e.do("GET", "/api/zettels", "", bearer(e.keyA)).Code; got != 401 {
		t.Fatalf("old key after regenerate: got %d want 401", got)
	}
	if got := e.do("GET", "/api/zettels", "", bearer(newKey)).Code; got != 200 {
		t.Fatalf("new key: got %d want 200", got)
	}
	st, _ := e.authRepo.GetAPIKeyStatus(e.userA.ID)
	if !st.Active || st.LastUsedAt == nil {
		t.Fatalf("status after use: %+v", st)
	}
	if err := e.authRepo.DeleteAPIKey(e.userA.ID); err != nil {
		t.Fatal(err)
	}
	if got := e.do("GET", "/api/zettels", "", bearer(newKey)).Code; got != 401 {
		t.Fatalf("revoked key: got %d want 401", got)
	}
}
