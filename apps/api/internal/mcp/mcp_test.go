package mcp_test

import (
	"context"
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
	"github.com/brunofullstack/zettelkasten/api/internal/drawings"
	"github.com/brunofullstack/zettelkasten/api/internal/images"
	mcpserver "github.com/brunofullstack/zettelkasten/api/internal/mcp"
	"github.com/brunofullstack/zettelkasten/api/internal/zettel"
	"github.com/go-chi/chi/v5"
	"github.com/golang-jwt/jwt/v5"
	sdk "github.com/modelcontextprotocol/go-sdk/mcp"
)

const jwtSecret = "test-secret"

type env struct {
	url    string
	svc    *zettel.Service
	userA  string
	keyA   string
	keyB   string
	tokenA string
}

type recNotifier struct{ events []zettel.ChangeEvent }

func (r *recNotifier) Changed(_ context.Context, _ string, ev zettel.ChangeEvent) {
	r.events = append(r.events, ev)
}

func sha(s string) string {
	sum := sha256.Sum256([]byte(s))
	return hex.EncodeToString(sum[:])
}

func newEnv(t *testing.T, n zettel.Notifier) *env {
	t.Helper()
	database, err := db.Open(filepath.Join(t.TempDir(), "t.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { database.Close() })
	authRepo := auth.NewRepository(database)
	a, _ := authRepo.CreateUser("alice", "password-a", "member")
	b, _ := authRepo.CreateUser("bob", "password-b", "member")
	keyA := "zk_" + strings.Repeat("ab", 32)
	keyB := "zk_" + strings.Repeat("cd", 32)
	if err := authRepo.SetAPIKey(a.ID, sha(keyA)); err != nil {
		t.Fatal(err)
	}
	if err := authRepo.SetAPIKey(b.ID, sha(keyB)); err != nil {
		t.Fatal(err)
	}
	drawingRepo := drawings.NewRepository(database)
	svc := zettel.NewService(zettel.NewRepository(database), images.NewRepository(database)).
		WithDrawings(drawingRepo).WithNotifier(n)

	r := chi.NewRouter()
	r.Group(func(r chi.Router) {
		r.Use(auth.RequireKey(authRepo))
		r.Handle("/api/mcp", mcpserver.Handler(svc, drawings.NewHandler(drawingRepo, 100<<20)))
	})
	srv := httptest.NewServer(r)
	t.Cleanup(srv.Close)

	tok := jwt.NewWithClaims(jwt.SigningMethodHS256, jwt.MapClaims{
		"sub": a.ID, "role": "member", "exp": time.Now().Add(time.Hour).Unix(),
	})
	tokenA, _ := tok.SignedString([]byte(jwtSecret))
	return &env{url: srv.URL + "/api/mcp", svc: svc, userA: a.ID, keyA: keyA, keyB: keyB, tokenA: tokenA}
}

type headerRT struct{ key string }

func (h headerRT) RoundTrip(r *http.Request) (*http.Response, error) {
	r = r.Clone(r.Context())
	r.Header.Set("Authorization", "Bearer "+h.key)
	return http.DefaultTransport.RoundTrip(r)
}

func (e *env) connect(t *testing.T, key string) *sdk.ClientSession {
	t.Helper()
	c := sdk.NewClient(&sdk.Implementation{Name: "test", Version: "0"}, nil)
	cs, err := c.Connect(context.Background(), &sdk.StreamableClientTransport{
		Endpoint: e.url, HTTPClient: &http.Client{Transport: headerRT{key}},
	}, nil)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { cs.Close() })
	return cs
}

func call(t *testing.T, cs *sdk.ClientSession, name string, args map[string]any) (*sdk.CallToolResult, string) {
	t.Helper()
	res, err := cs.CallTool(context.Background(), &sdk.CallToolParams{Name: name, Arguments: args})
	if err != nil {
		t.Fatalf("%s: %v", name, err)
	}
	var b strings.Builder
	for _, c := range res.Content {
		if tc, ok := c.(*sdk.TextContent); ok {
			b.WriteString(tc.Text)
		}
	}
	return res, b.String()
}

func structured(t *testing.T, res *sdk.CallToolResult, v any) {
	t.Helper()
	raw, err := json.Marshal(res.StructuredContent)
	if err != nil {
		t.Fatal(err)
	}
	if err := json.Unmarshal(raw, v); err != nil {
		t.Fatalf("structured: %v (%s)", err, raw)
	}
}

func (e *env) mk(t *testing.T, title, body string) string {
	t.Helper()
	z, err := e.svc.Create(context.Background(), e.userA, zettel.CreateInput{Title: title, Body: body})
	if err != nil {
		t.Fatal(err)
	}
	return z.ID
}

func TestAuthRequiresKey(t *testing.T) {
	e := newEnv(t, nil)
	init := `{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"x","version":"0"}}}`
	for name, hdr := range map[string]string{"sem credencial": "", "jwt": "Bearer " + e.tokenA, "chave inválida": "Bearer zk_" + strings.Repeat("00", 32)} {
		req, _ := http.NewRequest("POST", e.url, strings.NewReader(init))
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("Accept", "application/json, text/event-stream")
		if hdr != "" {
			req.Header.Set("Authorization", hdr)
		}
		resp, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		resp.Body.Close()
		if resp.StatusCode != http.StatusUnauthorized {
			t.Fatalf("%s: want 401, got %d", name, resp.StatusCode)
		}
	}
}

func TestInitializeAndToolList(t *testing.T) {
	e := newEnv(t, nil)
	cs := e.connect(t, e.keyA)
	ins := cs.InitializeResult().Instructions
	if !strings.Contains(ins, "[[título exato]]") || !strings.Contains(ins, "Busque antes de criar") {
		t.Fatalf("instructions sem as regras: %q", ins)
	}
	lt, err := cs.ListTools(context.Background(), nil)
	if err != nil {
		t.Fatal(err)
	}
	want := []string{"search_zettels", "read_zettel", "list_recent", "create_zettel", "edit_zettel", "set_tags",
		"rename_zettel", "delete_zettel", "get_links", "list_tags", "read_drawing", "write_drawing"}
	got := map[string]*sdk.Tool{}
	for _, tl := range lt.Tools {
		got[tl.Name] = tl
	}
	if len(got) != len(want) {
		t.Fatalf("want %d tools, got %d", len(want), len(got))
	}
	for _, n := range want {
		if got[n] == nil || got[n].Description == "" {
			t.Fatalf("tool %s ausente ou sem descrição", n)
		}
	}
	if a := got["delete_zettel"].Annotations; a == nil || a.DestructiveHint == nil || !*a.DestructiveHint {
		t.Fatal("delete_zettel sem destructiveHint")
	}
	if !got["set_tags"].Annotations.IdempotentHint || !got["search_zettels"].Annotations.ReadOnlyHint {
		t.Fatal("anotações de set_tags/search_zettels")
	}
}

func TestSearchAndReadByTitle(t *testing.T) {
	e := newEnv(t, nil)
	other := e.mk(t, "Iteração", "laços")
	e.mk(t, "SICP", "livro sobre recursão, veja [[Iteração]]")
	cs := e.connect(t, e.keyA)

	res, text := call(t, cs, "search_zettels", map[string]any{"query": "recurs"})
	if res.IsError || !strings.Contains(text, "SICP") {
		t.Fatalf("busca: %v %s", res.IsError, text)
	}
	res, text = call(t, cs, "read_zettel", map[string]any{"title": "sicp"})
	if res.IsError {
		t.Fatal(text)
	}
	var z struct {
		Body    string                       `json:"body"`
		LinksTo []struct{ ID, Title string } `json:"links_to"`
	}
	structured(t, res, &z)
	if !strings.Contains(z.Body, "recursão") || len(z.LinksTo) != 1 || z.LinksTo[0].ID != other {
		t.Fatalf("read_zettel: %+v", z)
	}
}

func TestCreateRejectsDuplicateAndMarksAgent(t *testing.T) {
	n := &recNotifier{}
	e := newEnv(t, n)
	id := e.mk(t, "recursão", "")
	cs := e.connect(t, e.keyA)

	res, text := call(t, cs, "create_zettel", map[string]any{"title": "Recursão"})
	if !res.IsError || !strings.Contains(text, id) {
		t.Fatalf("duplicata: isError=%v %s", res.IsError, text)
	}
	res, text = call(t, cs, "create_zettel", map[string]any{"title": "Nova", "tags": []string{"Minha Tag"}})
	if res.IsError {
		t.Fatal(text)
	}
	ev := n.events[len(n.events)-1]
	if ev.Source != auth.SourceAgent || ev.Op != "upsert" {
		t.Fatalf("evento: %+v", ev)
	}
	var out struct{ Tags []string }
	structured(t, res, &out)
	if len(out.Tags) != 1 || out.Tags[0] != "minha-tag" {
		t.Fatalf("tags: %v", out.Tags)
	}
}

func TestEditPatchAmbiguousAndWhole(t *testing.T) {
	e := newEnv(t, nil)
	id := e.mk(t, "E", "rascunho e rascunho")
	cs := e.connect(t, e.keyA)

	res, text := call(t, cs, "edit_zettel", map[string]any{"id": id, "old_string": "rascunho", "new_string": "x"})
	if !res.IsError || !strings.Contains(text, "2 vezes") {
		t.Fatalf("ambíguo: %v %s", res.IsError, text)
	}
	res, text = call(t, cs, "edit_zettel", map[string]any{"id": id, "old_string": "rascunho e", "new_string": "versão final e"})
	if res.IsError {
		t.Fatal(text)
	}
	if z, _ := e.svc.Get(e.userA, id); z.Body != "versão final e rascunho" {
		t.Fatalf("patch: %q", z.Body)
	}
	res, _ = call(t, cs, "edit_zettel", map[string]any{"id": id})
	if !res.IsError {
		t.Fatal("sem modo deveria falhar")
	}
	res, text = call(t, cs, "edit_zettel", map[string]any{"id": id, "body": "novo"})
	if res.IsError {
		t.Fatal(text)
	}
	if z, _ := e.svc.Get(e.userA, id); z.Body != "novo" {
		t.Fatalf("corpo inteiro: %q", z.Body)
	}
}

func TestRenameReportsRewritten(t *testing.T) {
	e := newEnv(t, nil)
	id := e.mk(t, "Velho", "")
	for _, n := range []string{"A", "B", "C"} {
		e.mk(t, n, "cita [[Velho]]")
	}
	cs := e.connect(t, e.keyA)
	res, text := call(t, cs, "rename_zettel", map[string]any{"id": id, "new_title": "Novo"})
	if res.IsError {
		t.Fatal(text)
	}
	var out struct {
		RewrittenCount int `json:"rewritten_count"`
	}
	structured(t, res, &out)
	if out.RewrittenCount != 3 || !strings.Contains(text, "3 zettel") {
		t.Fatalf("rename: %d %s", out.RewrittenCount, text)
	}
	_, links := call(t, cs, "get_links", map[string]any{"id": id})
	if !strings.Contains(links, "«A»") || !strings.Contains(links, "«C»") {
		t.Fatalf("links depois do rename: %s", links)
	}
}

func TestDeleteListsCiting(t *testing.T) {
	e := newEnv(t, nil)
	id := e.mk(t, "Alvo", "")
	e.mk(t, "A", "[[Alvo]]")
	e.mk(t, "B", "[[Alvo]]")
	cs := e.connect(t, e.keyA)
	res, text := call(t, cs, "delete_zettel", map[string]any{"id": id})
	if res.IsError || !strings.Contains(text, "«A»") || !strings.Contains(text, "«B»") {
		t.Fatalf("delete: %v %s", res.IsError, text)
	}
	if _, err := e.svc.Get(e.userA, id); err == nil {
		t.Fatal("zettel continua vivo")
	}
}

func TestIsolationBetweenUsers(t *testing.T) {
	e := newEnv(t, nil)
	id := e.mk(t, "Privado", "segredo")
	cs := e.connect(t, e.keyB)
	res, text := call(t, cs, "read_zettel", map[string]any{"id": id})
	if !res.IsError || strings.Contains(text, "segredo") {
		t.Fatalf("isolamento: %v %s", res.IsError, text)
	}
	res, _ = call(t, cs, "delete_zettel", map[string]any{"id": id})
	if !res.IsError {
		t.Fatal("outro usuário apagou")
	}
}

func TestDrawingsWriteAndRead(t *testing.T) {
	e := newEnv(t, nil)
	cs := e.connect(t, e.keyA)
	scene := `{"type":"zk-sketch","version":1,"strokes":[{"id":"a","tool":"pen","color":"#e03131","size":4,"points":[[1,2,0.5],[30,40,0.5]]}]}`
	bad := `<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>`
	res, text := call(t, cs, "write_drawing", map[string]any{"scene": scene, "svg": bad})
	if !res.IsError || !strings.Contains(text, "recusado") {
		t.Fatalf("svg com script: %v %s", res.IsError, text)
	}
	good := `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 50 50"><rect width="50" height="50" fill="#ffffff"/><path fill="#e03131" d="M1,2l29,38z"/></svg>`
	res, text = call(t, cs, "write_drawing", map[string]any{"scene": scene, "svg": good})
	if res.IsError {
		t.Fatal(text)
	}
	var w struct{ ID, Ref string }
	structured(t, res, &w)
	if !strings.Contains(text, "zk:draw/"+w.ID) {
		t.Fatalf("lembrete da referência: %s", text)
	}
	res, text = call(t, cs, "read_drawing", map[string]any{"id": w.ID})
	if res.IsError || !strings.Contains(text, "1 traço") || !strings.Contains(text, "#e03131") {
		t.Fatalf("read_drawing: %s", text)
	}
}
