package portability

import (
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
)

func TestSQLiteExportOneAtATime(t *testing.T) {
	h := (&Handler{}).WithSnapshot(filepath.Join(t.TempDir(), "live.db"))
	h.snapshotSem <- struct{}{} // outro export em andamento

	rec := httptest.NewRecorder()
	h.exportSQLiteForUser(rec, httptest.NewRequest("GET", "/api/export/sqlite", nil), "u")
	if rec.Code != 429 || rec.Header().Get("Retry-After") == "" {
		t.Fatalf("want 429 with Retry-After, got %d", rec.Code)
	}
}

func TestSQLiteExportCleansUpOnFailure(t *testing.T) {
	// Banco vivo inexistente: o ATTACH read-only falha no meio da geração.
	h := (&Handler{}).WithSnapshot(filepath.Join(t.TempDir(), "missing.db"))
	h.snapshotTmp = t.TempDir()

	rec := httptest.NewRecorder()
	h.exportSQLiteForUser(rec, httptest.NewRequest("GET", "/api/export/sqlite", nil), "u")
	if rec.Code != 500 {
		t.Fatalf("want 500, got %d", rec.Code)
	}
	left, _ := os.ReadDir(h.snapshotTmp)
	if len(left) != 0 {
		t.Fatalf("temp files left behind: %v", left)
	}
	if len(h.snapshotSem) != 0 {
		t.Fatal("semaphore must be released")
	}
}

func TestSQLiteExportDisabled(t *testing.T) {
	rec := httptest.NewRecorder()
	(&Handler{}).exportSQLiteForUser(rec, httptest.NewRequest("GET", "/", nil), "u")
	if rec.Code != 404 {
		t.Fatalf("want 404, got %d", rec.Code)
	}
}
