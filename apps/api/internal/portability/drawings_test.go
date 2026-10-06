package portability_test

import (
	"archive/zip"
	"bytes"
	"encoding/json"
	"io"
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
	"github.com/brunofullstack/zettelkasten/api/internal/portability"
	"github.com/brunofullstack/zettelkasten/api/internal/review"
	"github.com/brunofullstack/zettelkasten/api/internal/zettel"
	"github.com/go-chi/chi/v5"
	"github.com/golang-jwt/jwt/v5"
)

const jwtSecret = "test-secret"

const scene = `{"type":"excalidraw","version":2,"elements":[{"id":"a"}],"appState":{},"files":{}}`
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="120" height="80"><rect width="120" height="80"/></svg>`

type env struct {
	srv    http.Handler
	dRepo  *drawings.Repository
	userA  string
	userB  string
	tokenA string
	tokenB string
}

func newEnv(t *testing.T, quota int64) *env {
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

	dRepo := drawings.NewRepository(database)
	zRepo := zettel.NewRepository(database)
	zHandler := zettel.NewHandler(zRepo, images.NewRepository(database)).WithDrawings(dRepo)
	pHandler := portability.NewHandler(zRepo, authRepo, images.NewRepository(database), review.NewRepository(database)).
		WithDrawings(dRepo, quota)

	r := chi.NewRouter()
	r.Group(func(r chi.Router) {
		r.Use(auth.RequireAuthOrKey(jwtSecret, authRepo))
		r.Mount("/api/zettels", zHandler.Routes())
	})
	r.Group(func(r chi.Router) {
		r.Use(auth.RequireAuth(jwtSecret))
		r.Mount("/api", pHandler.Routes())
	})
	return &env{srv: r, dRepo: dRepo, userA: a.ID, userB: b.ID, tokenA: token(a.ID), tokenB: token(b.ID)}
}

func (e *env) do(method, path, token string, body io.Reader) *httptest.ResponseRecorder {
	req := httptest.NewRequest(method, path, body)
	req.Header.Set("Authorization", "Bearer "+token)
	rec := httptest.NewRecorder()
	e.srv.ServeHTTP(rec, req)
	return rec
}

func (e *env) seed(t *testing.T) {
	t.Helper()
	if _, err := e.dRepo.Upsert(e.userA, drawings.Drawing{
		ID: "dr1", Scene: scene, SVG: svg, ByteLen: int64(len(scene) + len(svg)),
		Width: 120, Height: 80, CreatedAt: 1000, UpdatedAt: 2000,
	}); err != nil {
		t.Fatal(err)
	}
	body, _ := json.Marshal(map[string]any{"title": "com desenho", "body": "olha ![croqui](zk:draw/dr1) aqui", "tags": []string{}})
	if rec := e.do("POST", "/api/zettels", e.tokenA, bytes.NewReader(body)); rec.Code >= 300 {
		t.Fatalf("seed zettel: %d %s", rec.Code, rec.Body.String())
	}
}

func zipEntries(t *testing.T, data []byte) map[string]string {
	t.Helper()
	zr, err := zip.NewReader(bytes.NewReader(data), int64(len(data)))
	if err != nil {
		t.Fatal(err)
	}
	out := map[string]string{}
	for _, f := range zr.File {
		rc, _ := f.Open()
		b, _ := io.ReadAll(rc)
		rc.Close()
		out[f.Name] = string(b)
	}
	return out
}

func TestZipExportCarriesDrawings(t *testing.T) {
	e := newEnv(t, 1<<20)
	e.seed(t)

	rec := e.do("GET", "/api/export/zip", e.tokenA, nil)
	if rec.Code != 200 {
		t.Fatalf("export: %d", rec.Code)
	}
	files := zipEntries(t, rec.Body.Bytes())
	if files["drawings/dr1.excalidraw"] != scene || files["drawings/dr1.svg"] != svg {
		t.Fatalf("zip must carry scene and svg, got keys: %v", keys(files))
	}
	// O JSON dentro do ZIP leva só metadados, nunca a cena.
	if strings.Contains(files["zettels.json"], `"elements"`) {
		t.Fatal("zettels.json must not contain the scene")
	}
	if !strings.Contains(files["zettels.json"], `"drawings"`) {
		t.Fatal("zettels.json should list drawing metadata")
	}
}

func TestJSONExportHasNoScene(t *testing.T) {
	e := newEnv(t, 1<<20)
	e.seed(t)
	rec := e.do("GET", "/api/export/json", e.tokenA, nil)
	if rec.Code != 200 {
		t.Fatalf("export: %d", rec.Code)
	}
	if strings.Contains(rec.Body.String(), `"elements"`) || strings.Contains(rec.Body.String(), "<svg") {
		t.Fatal("json export must not carry scene or svg")
	}
}

func TestZipRoundtripRestoresDrawingForAnotherUser(t *testing.T) {
	e := newEnv(t, 1<<20)
	e.seed(t)
	exported := zipEntries(t, e.do("GET", "/api/export/zip", e.tokenA, nil).Body.Bytes())

	// Reempacota com um zettel de id próprio: o id de zettel é PK global, então
	// importar o mesmo zettel para outro usuário no mesmo banco colidiria.
	var buf bytes.Buffer
	zw := zip.NewWriter(&buf)
	w, _ := zw.Create("zettels.json")
	w.Write([]byte(`{"version":1,"zettels":[{"id":"zimp1","title":"importado","body":"![](zk:draw/dr1)","tags":[],"created_at":1,"updated_at":2}],"links":[]}`))
	for _, name := range []string{"drawings/dr1.excalidraw", "drawings/dr1.svg"} {
		f, _ := zw.Create(name)
		f.Write([]byte(exported[name]))
	}
	zw.Close()

	rec := e.do("POST", "/api/import/zip", e.tokenB, &buf)
	if rec.Code != 200 {
		t.Fatalf("import: %d %s", rec.Code, rec.Body.String())
	}
	var res struct {
		Errors []string `json:"errors"`
	}
	json.Unmarshal(rec.Body.Bytes(), &res)
	if len(res.Errors) != 0 {
		t.Fatalf("unexpected import errors: %v", res.Errors)
	}

	d, err := e.dRepo.Get(e.userB, "dr1")
	if err != nil || d == nil {
		t.Fatalf("drawing must be restored for user B: %v", err)
	}
	if d.Scene != scene || d.SVG != svg || d.Width != 120 || d.Height != 80 {
		t.Fatalf("restored drawing differs: %+v", d)
	}
	// As refs foram reconciliadas: o desenho de B não está marcado como órfão.
	if n, _ := e.dRepo.PurgeOrphans(time.Now().UnixMilli() + 1000); n != 0 {
		t.Fatal("imported drawing must be referenced, not orphaned")
	}
}

func TestImportRejectsBadDrawingsButKeepsTheRest(t *testing.T) {
	e := newEnv(t, 1<<20)

	var buf bytes.Buffer
	zw := zip.NewWriter(&buf)
	w, _ := zw.Create("zettels.json")
	w.Write([]byte(`{"version":1,"zettels":[],"links":[]}`))
	add := func(name, content string) {
		f, _ := zw.Create(name)
		f.Write([]byte(content))
	}
	add("drawings/ok1.excalidraw", scene)
	add("drawings/ok1.svg", svg)
	add("drawings/bad1.excalidraw", `{"type":"other"}`)
	add("drawings/bad1.svg", svg)
	add("drawings/evil.excalidraw", scene)
	add("drawings/evil.svg", `<svg xmlns="http://www.w3.org/2000/svg"><script>x()</script></svg>`)
	add("drawings/onlyscene.excalidraw", scene)
	add("drawings/bad id.svg", svg)
	zw.Close()

	rec := e.do("POST", "/api/import/zip", e.tokenB, &buf)
	if rec.Code != 200 {
		t.Fatalf("import: %d %s", rec.Code, rec.Body.String())
	}
	var res struct {
		Errors []string `json:"errors"`
	}
	json.Unmarshal(rec.Body.Bytes(), &res)
	if len(res.Errors) != 4 {
		t.Fatalf("want 4 errors (bad scene, evil svg, missing svg, bad id), got %d: %v", len(res.Errors), res.Errors)
	}
	if d, _ := e.dRepo.Get(e.userB, "ok1"); d == nil {
		t.Fatal("valid drawing must still be imported")
	}
	for _, id := range []string{"bad1", "evil", "onlyscene"} {
		if d, _ := e.dRepo.Get(e.userB, id); d != nil {
			t.Fatalf("%s must not be imported", id)
		}
	}
}

func TestImportRespectsQuota(t *testing.T) {
	size := int64(len(scene) + len(svg))
	e := newEnv(t, size+size/2) // cabe um, não cabe dois

	var buf bytes.Buffer
	zw := zip.NewWriter(&buf)
	w, _ := zw.Create("zettels.json")
	w.Write([]byte(`{"version":1,"zettels":[],"links":[]}`))
	for _, id := range []string{"q1", "q2"} {
		f, _ := zw.Create("drawings/" + id + ".excalidraw")
		f.Write([]byte(scene))
		f, _ = zw.Create("drawings/" + id + ".svg")
		f.Write([]byte(svg))
	}
	zw.Close()

	rec := e.do("POST", "/api/import/zip", e.tokenB, &buf)
	var res struct {
		Errors []string `json:"errors"`
	}
	json.Unmarshal(rec.Body.Bytes(), &res)
	if len(res.Errors) != 1 || !strings.Contains(res.Errors[0], "quota") {
		t.Fatalf("want exactly one quota error, got %v", res.Errors)
	}
}

func TestMarkdownExportRewritesRefsToSVG(t *testing.T) {
	e := newEnv(t, 1<<20)
	e.seed(t)
	rec := e.do("GET", "/api/export/markdown", e.tokenA, nil)
	if rec.Code != 200 {
		t.Fatalf("export: %d", rec.Code)
	}
	files := zipEntries(t, rec.Body.Bytes())
	var md string
	for name, content := range files {
		if strings.HasSuffix(name, ".md") {
			md = content
		}
	}
	if !strings.Contains(md, "![croqui](drawings/dr1.svg)") || strings.Contains(md, "zk:draw/") {
		t.Fatalf("markdown must reference the svg, got: %q", md)
	}
	if files["drawings/dr1.svg"] != svg {
		t.Fatal("markdown package must include the svg")
	}
	if _, has := files["drawings/dr1.excalidraw"]; has {
		t.Fatal("markdown package must not include the scene")
	}
}

func keys(m map[string]string) []string {
	out := make([]string, 0, len(m))
	for k := range m {
		out = append(out, k)
	}
	return out
}
