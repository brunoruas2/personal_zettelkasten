package portability_test

import (
	"bytes"
	"encoding/json"
	"strings"
	"testing"

	"github.com/brunofullstack/zettelkasten/api/internal/types"
)

func conteudoType() types.Type {
	return types.Type{
		ID: "tc", Name: "Conteúdo", Slug: "conteudo", Icon: "📘", Color: "#a78bfa",
		Template: "## Captura\n\n## Minha síntese\n", ProtectedSections: []string{"Minha síntese"},
		CountsProgress: true, UpdatedAt: 7,
		Levels: []types.Level{
			{Key: "semente", Label: "Semente", Emoji: "🤖"},
			{Key: "consolidado", Label: "Consolidado", Emoji: "🧠", UserOnly: true},
		},
	}
}

// seedTyped cria um zettel (pelo seed) e o atribui ao tipo "conteudo".
func (e *env) seedTyped(t *testing.T) (zettelID string) {
	t.Helper()
	e.seed(t)
	rec := e.do("GET", "/api/zettels", e.tokenA, nil)
	var zs []struct {
		ID string `json:"id"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &zs); err != nil || len(zs) == 0 {
		t.Fatalf("list zettels: %v %s", err, rec.Body.String())
	}
	if _, err := e.tRepo.Upsert(e.userA, []types.Type{conteudoType()}, 100); err != nil {
		t.Fatal(err)
	}
	if _, err := e.tRepo.UpsertAssignments(e.userA, []types.Assignment{
		{ZettelID: zs[0].ID, TypeID: "tc", Level: "semente", UpdatedAt: 50},
	}, 200); err != nil {
		t.Fatal(err)
	}
	return zs[0].ID
}

func (e *env) wipeTypes(t *testing.T) {
	t.Helper()
	raw := openRaw(t, e.dbPath)
	mustExec(t, raw, `DELETE FROM zettel_type_assignments WHERE user_id = ?`, e.userA)
	mustExec(t, raw, `DELETE FROM zettel_types WHERE user_id = ?`, e.userA)
}

func (e *env) assertTypesRestored(t *testing.T, zid string) {
	t.Helper()
	got, err := e.tRepo.Get(e.userA, "tc")
	if err != nil {
		t.Fatalf("tipo não restaurado: %v", err)
	}
	want := conteudoType()
	if got.Slug != want.Slug || got.Template != want.Template || !got.CountsProgress ||
		len(got.Levels) != 2 || !got.Levels[1].UserOnly || len(got.ProtectedSections) != 1 {
		t.Fatalf("tipo restaurado diferente: %+v", got)
	}
	a, _ := e.tRepo.Assignment(e.userA, zid)
	if a == nil || a.TypeID != "tc" || a.Level != "semente" {
		t.Fatalf("atribuição não restaurada: %+v", a)
	}
}

func TestTypesRoundTripJSON(t *testing.T) {
	e := newEnv(t, 1<<20)
	zid := e.seedTyped(t)

	rec := e.do("GET", "/api/export/json", e.tokenA, nil)
	if rec.Code != 200 {
		t.Fatalf("export: %d", rec.Code)
	}
	exported := rec.Body.Bytes()
	if !strings.Contains(string(exported), `"types"`) || !strings.Contains(string(exported), `"type_assignments"`) {
		t.Fatal("export deve levar types e type_assignments")
	}
	e.wipeTypes(t)
	if rec := e.do("POST", "/api/import/json", e.tokenA, bytes.NewReader(exported)); rec.Code != 200 {
		t.Fatalf("import: %d %s", rec.Code, rec.Body.String())
	}
	e.assertTypesRestored(t, zid)
}

func TestTypesRoundTripZip(t *testing.T) {
	e := newEnv(t, 1<<20)
	zid := e.seedTyped(t)

	rec := e.do("GET", "/api/export/zip", e.tokenA, nil)
	if rec.Code != 200 {
		t.Fatalf("export: %d", rec.Code)
	}
	zipped := rec.Body.Bytes()
	e.wipeTypes(t)
	if rec := e.do("POST", "/api/import/zip", e.tokenA, bytes.NewReader(zipped)); rec.Code != 200 {
		t.Fatalf("import: %d %s", rec.Code, rec.Body.String())
	}
	e.assertTypesRestored(t, zid)
}

func TestExportNaoLevaTiposApagadosNemAtribuicaoDesfeita(t *testing.T) {
	e := newEnv(t, 1<<20)
	e.seedTyped(t)
	if _, err := e.tRepo.Delete(e.userA, "tc", 300); err != nil {
		t.Fatal(err)
	}
	rec := e.do("GET", "/api/export/json", e.tokenA, nil)
	if strings.Contains(rec.Body.String(), `"types"`) || strings.Contains(rec.Body.String(), `"type_assignments"`) {
		t.Fatalf("tipo apagado não deve ir no backup: %s", rec.Body.String())
	}
}

func TestImportDeBackupAntigoSemTiposNaoCriaNenhum(t *testing.T) {
	e := newEnv(t, 1<<20)
	payload := `{"version": 1, "exported_at": "2026-01-01T00:00:00Z",
		"zettels": [{"id": "20260101000000abcd", "title": "t", "body": "", "tags": [], "created_at": 1, "updated_at": 2}],
		"links": []}`
	if rec := e.do("POST", "/api/import/json", e.tokenA, strings.NewReader(payload)); rec.Code != 200 {
		t.Fatalf("import: %d %s", rec.Code, rec.Body.String())
	}
	if got, _ := e.tRepo.List(e.userA); len(got) != 0 {
		t.Fatalf("nenhum tipo esperado: %+v", got)
	}
}

func TestImportRegistraAtribuicaoDeZettelInexistenteESegue(t *testing.T) {
	e := newEnv(t, 1<<20)
	payload := `{"version": 1, "exported_at": "2026-01-01T00:00:00Z",
		"zettels": [{"id": "20260101000000abcd", "title": "t", "body": "", "tags": [], "created_at": 1, "updated_at": 2}],
		"links": [],
		"types": [{"id":"tc","name":"Conteúdo","slug":"conteudo","icon":"📘","color":"#a78bfa","template":"","protected_sections":[],"levels":[],"counts_progress":true,"updated_at":5}],
		"type_assignments": [
			{"zettel_id":"20260101000000abcd","type_id":"tc","level":"","updated_at":6},
			{"zettel_id":"naoexiste","type_id":"tc","level":"","updated_at":6}
		]}`
	rec := e.do("POST", "/api/import/json", e.tokenA, strings.NewReader(payload))
	if rec.Code != 200 {
		t.Fatalf("import: %d %s", rec.Code, rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), "naoexiste") {
		t.Fatalf("a atribuição do zettel inexistente devia aparecer em errors: %s", rec.Body.String())
	}
	if a, _ := e.tRepo.Assignment(e.userA, "20260101000000abcd"); a == nil {
		t.Fatal("a atribuição válida devia ter sido gravada")
	}
}

func TestImportComSlugEmConflitoVaiParaErrosSemBarrarOResto(t *testing.T) {
	e := newEnv(t, 1<<20)
	if _, err := e.tRepo.Upsert(e.userA, []types.Type{{
		ID: "outro", Name: "Outro", Slug: "conteudo", Icon: "📘", Color: "#a78bfa", UpdatedAt: 1,
	}}, 10); err != nil {
		t.Fatal(err)
	}
	payload := `{"version": 1, "exported_at": "2026-01-01T00:00:00Z",
		"zettels": [{"id": "20260101000000abcd", "title": "t", "body": "", "tags": [], "created_at": 1, "updated_at": 2}],
		"links": [],
		"types": [
			{"id":"tc","name":"Conteúdo","slug":"conteudo","icon":"📘","color":"#a78bfa","template":"","protected_sections":[],"levels":[],"counts_progress":false,"updated_at":5},
			{"id":"tf","name":"Fonte","slug":"fonte","icon":"📚","color":"#60a5fa","template":"","protected_sections":[],"levels":[],"counts_progress":false,"updated_at":5}
		]}`
	rec := e.do("POST", "/api/import/json", e.tokenA, strings.NewReader(payload))
	if rec.Code != 200 {
		t.Fatalf("import: %d %s", rec.Code, rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), "conteudo") {
		t.Fatalf("o conflito de slug devia aparecer em errors: %s", rec.Body.String())
	}
	if _, err := e.tRepo.Resolve(e.userA, "fonte"); err != nil {
		t.Fatalf("o outro tipo devia ter sido importado: %v", err)
	}
}

func TestSQLiteSnapshotLevaOsTiposSoDoDono(t *testing.T) {
	e := newEnv(t, 1<<20)
	zid := e.seedTyped(t)
	// Outro usuário também tem um tipo (mesmo slug); não pode vazar para o snapshot.
	other := conteudoType()
	other.ID = "tb"
	if _, err := e.tRepo.Upsert(e.userB, []types.Type{other}, 100); err != nil {
		t.Fatal(err)
	}

	snap := openRaw(t, e.download(t))
	for q, want := range map[string]int{
		`SELECT COUNT(*) FROM zettel_types`:                                                                  1,
		`SELECT COUNT(*) FROM zettel_types WHERE user_id != '` + e.userA + `'`:                               0,
		`SELECT COUNT(*) FROM zettel_type_assignments`:                                                       1,
		`SELECT COUNT(*) FROM zettel_type_assignments WHERE zettel_id = '` + zid + `' AND level = 'semente'`: 1,
	} {
		if n := count(t, snap, q); n != want {
			t.Errorf("%s = %d, want %d", q, n, want)
		}
	}
	var levels string
	snap.QueryRow(`SELECT levels FROM zettel_types`).Scan(&levels)
	if !strings.Contains(levels, `"user_only":true`) {
		t.Errorf("levels do snapshot: %s", levels)
	}
}
