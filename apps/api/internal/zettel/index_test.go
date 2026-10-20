package zettel_test

import (
	"bytes"
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
	"github.com/brunofullstack/zettelkasten/api/internal/zettel"
	"github.com/go-chi/chi/v5"
	"github.com/golang-jwt/jwt/v5"
)

const jwtSecret = "test-secret"

type env struct {
	srv    http.Handler
	tokenA string
	tokenB string
	keyA   string
}

func newEnv(t *testing.T) *env {
	t.Helper()
	database, err := db.Open(filepath.Join(t.TempDir(), "t.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { database.Close() })

	authRepo := auth.NewRepository(database)
	a, _ := authRepo.CreateUser("alice", "password-a", "member")
	b, _ := authRepo.CreateUser("bob", "password-b", "member")
	token := func(id string) string {
		tok := jwt.NewWithClaims(jwt.SigningMethodHS256, jwt.MapClaims{
			"sub": id, "role": "member", "exp": time.Now().Add(time.Hour).Unix(),
		})
		s, _ := tok.SignedString([]byte(jwtSecret))
		return s
	}
	keyA := "zk_" + strings.Repeat("ab", 32)
	sum := sha256.Sum256([]byte(keyA))
	if err := authRepo.SetAPIKey(a.ID, hex.EncodeToString(sum[:])); err != nil {
		t.Fatal(err)
	}

	h := zettel.NewHandler(zettel.NewRepository(database), images.NewRepository(database))
	r := chi.NewRouter()
	r.Group(func(r chi.Router) {
		r.Use(auth.RequireAuthOrKey(jwtSecret, authRepo))
		r.Mount("/api/zettels", h.Routes())
	})
	return &env{srv: r, tokenA: token(a.ID), tokenB: token(b.ID), keyA: keyA}
}

func (e *env) do(t *testing.T, method, path, token string, body any) *httptest.ResponseRecorder {
	t.Helper()
	var buf bytes.Buffer
	if body != nil {
		json.NewEncoder(&buf).Encode(body) //nolint:errcheck
	}
	req := httptest.NewRequest(method, path, &buf)
	req.Header.Set("Authorization", "Bearer "+token)
	rec := httptest.NewRecorder()
	e.srv.ServeHTTP(rec, req)
	return rec
}

func (e *env) create(t *testing.T, title, body string) string {
	t.Helper()
	rec := e.do(t, "POST", "/api/zettels", e.tokenA, map[string]any{"title": title, "body": body, "tags": []string{"t"}})
	if rec.Code >= 300 {
		t.Fatalf("create: %d %s", rec.Code, rec.Body.String())
	}
	var z struct {
		ID string `json:"id"`
	}
	json.Unmarshal(rec.Body.Bytes(), &z) //nolint:errcheck
	return z.ID
}

func TestListMetaHasNoBodyAndCountsBytes(t *testing.T) {
	e := newEnv(t)
	id := e.create(t, "acentos", "ação")

	rec := e.do(t, "GET", "/api/zettels?fields=meta", e.tokenA, nil)
	if rec.Code != 200 {
		t.Fatalf("list meta: %d", rec.Code)
	}
	if strings.Contains(rec.Body.String(), `"body"`) {
		t.Fatalf("meta list must not carry bodies: %s", rec.Body.String())
	}
	var metas []struct {
		ID      string `json:"id"`
		BodyLen int64  `json:"body_len"`
	}
	json.Unmarshal(rec.Body.Bytes(), &metas) //nolint:errcheck
	if len(metas) != 1 || metas[0].ID != id || metas[0].BodyLen != 6 {
		t.Fatalf("want one meta with body_len 6 (utf-8 bytes), got %+v", metas)
	}

	// Sem fields, o comportamento antigo (com corpo) continua.
	if rec := e.do(t, "GET", "/api/zettels", e.tokenA, nil); !strings.Contains(rec.Body.String(), `"body":"ação"`) {
		t.Fatalf("plain list must keep bodies: %s", rec.Body.String())
	}
}

func TestListMetaDeltaIncludesDeleted(t *testing.T) {
	e := newEnv(t)
	id := e.create(t, "vai sumir", "x")
	if rec := e.do(t, "DELETE", "/api/zettels/"+id, e.tokenA, nil); rec.Code >= 300 {
		t.Fatalf("delete: %d", rec.Code)
	}
	rec := e.do(t, "GET", "/api/zettels?fields=meta&since=1", e.tokenA, nil)
	var metas []struct {
		ID        string `json:"id"`
		DeletedAt *int64 `json:"deleted_at"`
	}
	json.Unmarshal(rec.Body.Bytes(), &metas) //nolint:errcheck
	if len(metas) != 1 || metas[0].DeletedAt == nil {
		t.Fatalf("delta must report the deletion, got %+v", metas)
	}
}

func TestBodiesBatch(t *testing.T) {
	e := newEnv(t)
	a := e.create(t, "a", "corpo a")
	b := e.create(t, "b", "corpo b")

	rec := e.do(t, "POST", "/api/zettels/bodies", e.tokenA, map[string]any{"ids": []string{a, b, "naoexiste"}})
	if rec.Code != 200 {
		t.Fatalf("bodies: %d %s", rec.Code, rec.Body.String())
	}
	var got []struct {
		ID        string `json:"id"`
		Body      string `json:"body"`
		UpdatedAt int64  `json:"updated_at"`
	}
	json.Unmarshal(rec.Body.Bytes(), &got) //nolint:errcheck
	if len(got) != 2 {
		t.Fatalf("want 2 bodies, got %+v", got)
	}
	for _, g := range got {
		if g.UpdatedAt == 0 || !strings.HasPrefix(g.Body, "corpo ") {
			t.Fatalf("bad body entry %+v", g)
		}
	}

	// Bob não lê corpos de Alice.
	rec = e.do(t, "POST", "/api/zettels/bodies", e.tokenB, map[string]any{"ids": []string{a, b}})
	if strings.Contains(rec.Body.String(), "corpo") {
		t.Fatalf("isolation broken: %s", rec.Body.String())
	}
}

func TestBodiesLimitsAndAPIKey(t *testing.T) {
	e := newEnv(t)
	ids := make([]string, 201)
	for i := range ids {
		ids[i] = "x"
	}
	if rec := e.do(t, "POST", "/api/zettels/bodies", e.tokenA, map[string]any{"ids": ids}); rec.Code != http.StatusBadRequest {
		t.Fatalf("201 ids: want 400, got %d", rec.Code)
	}
	if rec := e.do(t, "POST", "/api/zettels/bodies", e.tokenA, map[string]any{"ids": []string{"../x"}}); rec.Code != http.StatusBadRequest {
		t.Fatalf("invalid id: want 400, got %d", rec.Code)
	}
	if rec := e.do(t, "POST", "/api/zettels/bodies", e.keyA, map[string]any{"ids": []string{"x"}}); rec.Code != http.StatusForbidden {
		t.Fatalf("api key: want 403, got %d", rec.Code)
	}
}
