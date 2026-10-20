package positions_test

import (
	"bytes"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/brunofullstack/zettelkasten/api/internal/auth"
	"github.com/brunofullstack/zettelkasten/api/internal/db"
	"github.com/brunofullstack/zettelkasten/api/internal/images"
	"github.com/brunofullstack/zettelkasten/api/internal/positions"
	"github.com/brunofullstack/zettelkasten/api/internal/zettel"
	"github.com/go-chi/chi/v5"
	"github.com/golang-jwt/jwt/v5"
)

const jwtSecret = "test-secret"

type env struct {
	srv      http.Handler
	authRepo *auth.Repository
	userA    string
	tokenA   string
	tokenB   string
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

	zHandler := zettel.NewHandler(zettel.NewRepository(database), images.NewRepository(database))
	pHandler := positions.NewHandler(positions.NewRepository(database))

	r := chi.NewRouter()
	r.Group(func(r chi.Router) {
		r.Use(auth.RequireAuthOrKey(jwtSecret, authRepo))
		r.Mount("/api/zettels", zHandler.Routes())
	})
	r.Group(func(r chi.Router) {
		r.Use(auth.RequireAuth(jwtSecret))
		r.Get("/api/positions", pHandler.List)
		r.Put("/api/positions", pHandler.Put)
		r.Post("/api/positions/init", pHandler.Init)
		r.Delete("/api/positions", pHandler.Reset)
	})
	return &env{srv: r, authRepo: authRepo, userA: a.ID, tokenA: token(a.ID), tokenB: token(b.ID)}
}

func (e *env) do(t *testing.T, method, path, token string, body any) *httptest.ResponseRecorder {
	t.Helper()
	var rd io.Reader
	if body != nil {
		raw, _ := json.Marshal(body)
		rd = bytes.NewReader(raw)
	}
	req := httptest.NewRequest(method, path, rd)
	req.Header.Set("Authorization", "Bearer "+token)
	rec := httptest.NewRecorder()
	e.srv.ServeHTTP(rec, req)
	return rec
}

// zettel cria um zettel de alice e devolve o id.
func (e *env) zettel(t *testing.T, title string) string {
	t.Helper()
	rec := e.do(t, "POST", "/api/zettels", e.tokenA, map[string]any{"title": title, "body": "", "tags": []string{}})
	if rec.Code >= 300 {
		t.Fatalf("create zettel: %d %s", rec.Code, rec.Body.String())
	}
	var z struct {
		ID string `json:"id"`
	}
	json.Unmarshal(rec.Body.Bytes(), &z) //nolint:errcheck
	return z.ID
}

type listResp struct {
	Positions  []positions.Entry `json:"positions"`
	Epoch      int               `json:"epoch"`
	ServerTime int64             `json:"server_time"`
}

func (e *env) list(t *testing.T, token string, since int64) listResp {
	t.Helper()
	rec := e.do(t, "GET", "/api/positions?since="+strconv.FormatInt(since, 10), token, nil)
	if rec.Code != 200 {
		t.Fatalf("list: %d %s", rec.Code, rec.Body.String())
	}
	var out listResp
	if err := json.Unmarshal(rec.Body.Bytes(), &out); err != nil {
		t.Fatal(err)
	}
	return out
}

func entry(id string, x, y float64, updated int64) map[string]any {
	return map[string]any{"id": id, "x": x, "y": y, "updated_at": updated}
}

func put(t *testing.T, e *env, mode string, items ...map[string]any) []positions.Entry {
	kept, _ := putFull(t, e, mode, items...)
	return kept
}

func putFull(t *testing.T, e *env, mode string, items ...map[string]any) ([]positions.Entry, []string) {
	t.Helper()
	rec := e.do(t, "PUT", "/api/positions", e.tokenA, map[string]any{"mode": mode, "positions": items})
	if rec.Code != 200 {
		t.Fatalf("put: %d %s", rec.Code, rec.Body.String())
	}
	var out struct {
		Kept    []positions.Entry `json:"kept"`
		Skipped []string          `json:"skipped"`
	}
	json.Unmarshal(rec.Body.Bytes(), &out) //nolint:errcheck
	return out.Kept, out.Skipped
}

func find(list []positions.Entry, id string) *positions.Entry {
	for i := range list {
		if list[i].ID == id {
			return &list[i]
		}
	}
	return nil
}

func TestPutRoundsAndDelta(t *testing.T) {
	e := newEnv(t)
	z1, z2 := e.zettel(t, "um"), e.zettel(t, "dois")

	put(t, e, "lww", entry(z1, 120.6, -33.2, 10))
	mid := e.list(t, e.tokenA, 0).ServerTime
	time.Sleep(3 * time.Millisecond)
	put(t, e, "lww", entry(z2, 0, 0, 10))

	all := e.list(t, e.tokenA, 0).Positions
	if p := find(all, z1); p == nil || p.X != 121 || p.Y != -33 {
		t.Fatalf("want z1 at (121,-33), got %+v", p)
	}
	delta := e.list(t, e.tokenA, mid+1).Positions
	if len(delta) != 1 || delta[0].ID != z2 {
		t.Fatalf("delta should hold only z2, got %+v", delta)
	}
}

func TestLWWIgnoresOlderWrite(t *testing.T) {
	e := newEnv(t)
	z := e.zettel(t, "z")
	put(t, e, "lww", entry(z, 10, 10, 200))

	kept := put(t, e, "lww", entry(z, 99, 99, 200))
	if p := find(kept, z); p == nil || p.X != 10 {
		t.Fatalf("equal updated_at must keep (10,10), kept=%+v", kept)
	}
	put(t, e, "lww", entry(z, 50, 50, 201))
	if p := find(e.list(t, e.tokenA, 0).Positions, z); p.X != 50 {
		t.Fatalf("newer write must win, got %+v", p)
	}
}

func TestIfAbsentKeepsExisting(t *testing.T) {
	e := newEnv(t)
	z := e.zettel(t, "z")
	put(t, e, "if_absent", entry(z, 1, 2, 5))
	kept := put(t, e, "if_absent", entry(z, 300, 400, 999))
	if p := find(kept, z); p == nil || p.X != 1 || p.Y != 2 {
		t.Fatalf("if_absent must return the existing position, kept=%+v", kept)
	}
}

func TestUnknownIDIgnored(t *testing.T) {
	e := newEnv(t)
	z := e.zettel(t, "z")
	kept, skipped := putFull(t, e, "lww", entry("naoexiste", 1, 1, 1), entry(z, 2, 2, 1))
	if len(kept) != 0 || len(skipped) != 1 || skipped[0] != "naoexiste" {
		t.Fatalf("unknown id must be reported as skipped only, kept=%+v skipped=%v", kept, skipped)
	}
	got := e.list(t, e.tokenA, 0).Positions
	if len(got) != 1 || got[0].ID != z {
		t.Fatalf("only the real zettel is stored, got %+v", got)
	}
}

func TestInitIsAllOrNothing(t *testing.T) {
	e := newEnv(t)
	z1, z2 := e.zettel(t, "um"), e.zettel(t, "dois")

	rec := e.do(t, "POST", "/api/positions/init", e.tokenA, map[string]any{
		"positions": []map[string]any{entry(z1, 0, 0, 1), entry(z2, 600, 0, 1)},
	})
	if rec.Code != 200 {
		t.Fatalf("first init: %d %s", rec.Code, rec.Body.String())
	}
	rec = e.do(t, "POST", "/api/positions/init", e.tokenA, map[string]any{
		"positions": []map[string]any{entry(z1, 9999, 9999, 2)},
	})
	if rec.Code != http.StatusConflict {
		t.Fatalf("second init: want 409, got %d", rec.Code)
	}
	if p := find(e.list(t, e.tokenA, 0).Positions, z1); p.X != 0 {
		t.Fatalf("second init must write nothing, got %+v", p)
	}
}

func TestResetBumpsEpoch(t *testing.T) {
	e := newEnv(t)
	z := e.zettel(t, "z")
	put(t, e, "lww", entry(z, 1, 1, 1))
	if ep := e.list(t, e.tokenA, 0).Epoch; ep != 0 {
		t.Fatalf("initial epoch: %d", ep)
	}
	if rec := e.do(t, "DELETE", "/api/positions", e.tokenA, nil); rec.Code != 200 {
		t.Fatalf("reset: %d", rec.Code)
	}
	got := e.list(t, e.tokenA, 0)
	if len(got.Positions) != 0 || got.Epoch != 1 {
		t.Fatalf("after reset want empty + epoch 1, got %+v", got)
	}
	// Um PUT de settings não pode mexer na época.
	if err := e.authRepo.UpdateUserSettings(e.userA, auth.UserSettings{ZettelTemplate: "x"}); err != nil {
		t.Fatal(err)
	}
	if ep := e.list(t, e.tokenA, 0).Epoch; ep != 1 {
		t.Fatalf("settings update must preserve epoch, got %d", ep)
	}
	// Init volta a ser aceito depois do reset.
	rec := e.do(t, "POST", "/api/positions/init", e.tokenA, map[string]any{"positions": []map[string]any{entry(z, 5, 5, 2)}})
	if rec.Code != 200 {
		t.Fatalf("init after reset: %d", rec.Code)
	}
}

func TestDeleteZettelDropsPosition(t *testing.T) {
	e := newEnv(t)
	z := e.zettel(t, "z")
	put(t, e, "lww", entry(z, 1, 1, 1))
	if rec := e.do(t, "DELETE", "/api/zettels/"+z, e.tokenA, nil); rec.Code >= 300 {
		t.Fatalf("delete zettel: %d", rec.Code)
	}
	if got := e.list(t, e.tokenA, 0).Positions; len(got) != 0 {
		t.Fatalf("position must go with the zettel, got %+v", got)
	}
}

func TestIsolationAndAPIKey(t *testing.T) {
	e := newEnv(t)
	z := e.zettel(t, "z")
	put(t, e, "lww", entry(z, 1, 1, 1))
	if got := e.list(t, e.tokenB, 0).Positions; len(got) != 0 {
		t.Fatalf("bob must not see alice's positions, got %+v", got)
	}
	// Bob não grava posição em zettel de Alice.
	rec := e.do(t, "PUT", "/api/positions", e.tokenB, map[string]any{"mode": "lww", "positions": []map[string]any{entry(z, 7, 7, 99)}})
	if rec.Code != 200 {
		t.Fatalf("bob put: %d", rec.Code)
	}
	if p := find(e.list(t, e.tokenA, 0).Positions, z); p.X != 1 {
		t.Fatalf("bob changed alice's position: %+v", p)
	}
	if rec := e.do(t, "GET", "/api/positions", "zk_"+strings.Repeat("ab", 32), nil); rec.Code != http.StatusUnauthorized {
		t.Fatalf("api key: want 401, got %d", rec.Code)
	}
}

func TestValidation(t *testing.T) {
	e := newEnv(t)
	z := e.zettel(t, "z")
	cases := []map[string]any{
		{"mode": "outro", "positions": []map[string]any{entry(z, 1, 1, 1)}},
		{"mode": "lww", "positions": []map[string]any{entry(z, 1, 1, 0)}},
		{"mode": "lww", "positions": []map[string]any{entry(z, 2e9, 1, 1)}},
		{"mode": "lww", "positions": []map[string]any{entry("../x", 1, 1, 1)}},
	}
	for i, c := range cases {
		if rec := e.do(t, "PUT", "/api/positions", e.tokenA, c); rec.Code != http.StatusBadRequest {
			t.Fatalf("case %d: want 400, got %d", i, rec.Code)
		}
	}
}
