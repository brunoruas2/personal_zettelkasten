package db

import (
	"database/sql"
	"path/filepath"
	"testing"
)

// Um banco de antes da remoção da revisão espaçada ainda tem a tabela
// `reviews`: o boot tem de descartá-la, e bootar de novo não pode falhar.
func TestOpenDropsLegacyReviewsTable(t *testing.T) {
	path := filepath.Join(t.TempDir(), "t.db")

	database, err := Open(path)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := database.Exec(`
		CREATE TABLE reviews (user_id TEXT NOT NULL, zettel_id TEXT NOT NULL, due_at INTEGER NOT NULL, PRIMARY KEY (user_id, zettel_id));
		CREATE INDEX idx_reviews_due ON reviews(user_id, due_at);
		INSERT INTO reviews VALUES ('u', 'z', 1);
	`); err != nil {
		t.Fatal(err)
	}
	database.Close()

	for i := 0; i < 2; i++ {
		database, err = Open(path)
		if err != nil {
			t.Fatalf("boot %d: %v", i+1, err)
		}
		if exists(t, database, "table", "reviews") || exists(t, database, "index", "idx_reviews_due") {
			t.Fatalf("boot %d: reviews table or index still present", i+1)
		}
		database.Close()
	}
}

func exists(t *testing.T, database *sql.DB, kind, name string) bool {
	t.Helper()
	var n int
	if err := database.QueryRow(`SELECT COUNT(*) FROM sqlite_master WHERE type=? AND name=?`, kind, name).Scan(&n); err != nil {
		t.Fatal(err)
	}
	return n > 0
}
