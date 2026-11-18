package auth_test

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/brunofullstack/zettelkasten/api/internal/auth"
	"github.com/go-chi/chi/v5"
)

// A origem da requisição vai para o contexto: chave zk_ = agent, JWT = ui.
func TestRequestSource(t *testing.T) {
	e := newEnv(t)
	var got string
	r := chi.NewRouter()
	r.With(auth.RequireAuthOrKey(jwtSecret, e.authRepo)).Get("/api/zettels", func(w http.ResponseWriter, req *http.Request) {
		got = auth.GetSource(req.Context())
	})

	for _, c := range []struct {
		hdr  map[string]string
		want string
	}{
		{bearer(e.keyA), auth.SourceAgent},
		{map[string]string{"X-API-Key": e.keyA}, auth.SourceAgent},
		{bearer(e.tokenA), auth.SourceUI},
	} {
		got = ""
		req := httptest.NewRequest("GET", "/api/zettels", nil)
		for k, v := range c.hdr {
			req.Header.Set(k, v)
		}
		r.ServeHTTP(httptest.NewRecorder(), req)
		if got != c.want {
			t.Fatalf("source: want %q, got %q", c.want, got)
		}
	}
	if s := auth.GetSource(httptest.NewRequest("GET", "/", nil).Context()); s != auth.SourceUI {
		t.Fatalf("default source: want ui, got %q", s)
	}
}
