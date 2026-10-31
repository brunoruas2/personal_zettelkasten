package zettel_test

import "testing"

func TestCreateEmptyTitleWithID(t *testing.T) {
	e := newEnv(t)
	rec := e.do(t, "POST", "/api/zettels", e.tokenA, map[string]any{"id": "20261030234744epzh", "title": "", "body": ""})
	if rec.Code != 201 {
		t.Fatalf("empty title with id: want 201, got %d %s", rec.Code, rec.Body.String())
	}
	put := e.do(t, "PUT", "/api/zettels/20261030234744epzh", e.tokenA, map[string]any{"title": "sss", "body": "ssss", "tags": []string{}})
	if put.Code != 200 {
		t.Fatalf("update after create: want 200, got %d %s", put.Code, put.Body.String())
	}
}

func TestCreateEmptyTitleWithoutIDRejected(t *testing.T) {
	e := newEnv(t)
	rec := e.do(t, "POST", "/api/zettels", e.tokenA, map[string]any{"title": "", "body": "x"})
	if rec.Code != 400 {
		t.Fatalf("empty title without id: want 400, got %d", rec.Code)
	}
}

func TestCreateDuplicateIDConflicts(t *testing.T) {
	e := newEnv(t)
	body := map[string]any{"id": "dup1", "title": "a", "body": ""}
	if rec := e.do(t, "POST", "/api/zettels", e.tokenA, body); rec.Code != 201 {
		t.Fatalf("first create: %d", rec.Code)
	}
	if rec := e.do(t, "POST", "/api/zettels", e.tokenA, body); rec.Code != 409 {
		t.Fatalf("duplicate id: want 409, got %d", rec.Code)
	}
}
