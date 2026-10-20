package portability_test

import (
	"bytes"
	"encoding/json"
	"strings"
	"testing"
	"time"

	"github.com/brunofullstack/zettelkasten/api/internal/positions"
)

// seedPosition cria o zettel do seed e grava a posição dele.
func (e *env) seedPosition(t *testing.T) positions.Entry {
	t.Helper()
	e.seed(t)
	rec := e.do("GET", "/api/zettels", e.tokenA, nil)
	var zs []struct {
		ID string `json:"id"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &zs); err != nil || len(zs) == 0 {
		t.Fatalf("list zettels: %v %s", err, rec.Body.String())
	}
	p := positions.Entry{ID: zs[0].ID, X: 1234, Y: -567, UpdatedAt: 42}
	if _, _, err := e.posRepo.Upsert(e.userA, []positions.Entry{p}, positions.ModeLWW, time.Now().UnixMilli()); err != nil {
		t.Fatal(err)
	}
	return p
}

func (e *env) positionsOf(t *testing.T) []positions.Entry {
	t.Helper()
	got, err := e.posRepo.Since(e.userA, 0)
	if err != nil {
		t.Fatal(err)
	}
	return got
}

func TestPositionsRoundTripJSON(t *testing.T) {
	e := newEnv(t, 1<<20)
	want := e.seedPosition(t)

	rec := e.do("GET", "/api/export/json", e.tokenA, nil)
	if rec.Code != 200 {
		t.Fatalf("export: %d", rec.Code)
	}
	exported := rec.Body.Bytes()
	if !strings.Contains(string(exported), `"positions"`) {
		t.Fatal("export must carry positions")
	}

	if _, err := e.posRepo.Reset(e.userA); err != nil {
		t.Fatal(err)
	}
	if rec := e.do("POST", "/api/import/json", e.tokenA, bytes.NewReader(exported)); rec.Code != 200 {
		t.Fatalf("import: %d %s", rec.Code, rec.Body.String())
	}
	got := e.positionsOf(t)
	if len(got) != 1 || got[0] != want {
		t.Fatalf("want %+v restored, got %+v", want, got)
	}
}

func TestPositionsRoundTripZip(t *testing.T) {
	e := newEnv(t, 1<<20)
	want := e.seedPosition(t)

	rec := e.do("GET", "/api/export/zip", e.tokenA, nil)
	if rec.Code != 200 {
		t.Fatalf("export: %d", rec.Code)
	}
	zipped := rec.Body.Bytes()
	if _, err := e.posRepo.Reset(e.userA); err != nil {
		t.Fatal(err)
	}
	if rec := e.do("POST", "/api/import/zip", e.tokenA, bytes.NewReader(zipped)); rec.Code != 200 {
		t.Fatalf("import: %d %s", rec.Code, rec.Body.String())
	}
	got := e.positionsOf(t)
	if len(got) != 1 || got[0] != want {
		t.Fatalf("want %+v restored, got %+v", want, got)
	}
}

func TestImportWithoutPositionsCreatesNone(t *testing.T) {
	e := newEnv(t, 1<<20)
	payload := `{"version": 1, "exported_at": "2026-01-01T00:00:00Z",
		"zettels": [{"id": "20260101000000abcd", "title": "t", "body": "", "tags": [], "created_at": 1, "updated_at": 2}],
		"links": []}`
	if rec := e.do("POST", "/api/import/json", e.tokenA, strings.NewReader(payload)); rec.Code != 200 {
		t.Fatalf("import: %d %s", rec.Code, rec.Body.String())
	}
	if got := e.positionsOf(t); len(got) != 0 {
		t.Fatalf("no positions expected, got %+v", got)
	}
}
