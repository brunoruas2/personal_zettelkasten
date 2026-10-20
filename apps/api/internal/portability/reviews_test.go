package portability_test

import (
	"encoding/json"
	"strings"
	"testing"
)

// Backups anteriores à remoção da revisão espaçada trazem o campo `reviews`.
// O import tem de aceitá-los e simplesmente ignorar o campo.
func TestImportJSONIgnoresLegacyReviews(t *testing.T) {
	e := newEnv(t, 1<<20)

	payload := `{
		"version": 1,
		"exported_at": "2026-09-01T00:00:00Z",
		"zettels": [{"id": "20260901000000abcd", "title": "antigo", "body": "corpo", "tags": [], "created_at": 1000, "updated_at": 2000}],
		"links": [],
		"reviews": [{"zettel_id": "20260901000000abcd", "due_at": 3000, "interval_days": 6, "ease": 2.5, "reps": 2, "lapses": 0, "last_reviewed_at": 2500, "suspended": false, "updated_at": 2500}]
	}`
	rec := e.do("POST", "/api/import/json", e.tokenA, strings.NewReader(payload))
	if rec.Code != 200 {
		t.Fatalf("import: %d %s", rec.Code, rec.Body.String())
	}
	var res struct {
		Imported int      `json:"imported"`
		Errors   []string `json:"errors"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &res); err != nil {
		t.Fatal(err)
	}
	if res.Imported != 1 || len(res.Errors) != 0 {
		t.Fatalf("want 1 imported and no errors, got %+v", res)
	}
}

func TestJSONExportHasNoReviews(t *testing.T) {
	e := newEnv(t, 1<<20)
	e.seed(t)

	rec := e.do("GET", "/api/export/json", e.tokenA, nil)
	if rec.Code != 200 {
		t.Fatalf("export: %d", rec.Code)
	}
	if strings.Contains(rec.Body.String(), `"reviews"`) {
		t.Fatal("export must not carry reviews")
	}
}
