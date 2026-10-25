package portability_test

import (
	"bytes"
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/brunofullstack/zettelkasten/api/internal/db"
	"github.com/brunofullstack/zettelkasten/api/internal/drawings"
	"github.com/brunofullstack/zettelkasten/api/internal/portability"
	"github.com/brunofullstack/zettelkasten/api/internal/positions"
	"golang.org/x/crypto/bcrypt"
	_ "modernc.org/sqlite"
)

var imgBytes = []byte{0x89, 'P', 'N', 'G', 0, 1, 2, 3, 255, 254}

// seedBoth dá aos dois usuários zettels (um apagado), links, imagem, desenho,
// posição e segredos de sessão, direto no banco.
func (e *env) seedBoth(t *testing.T) {
	t.Helper()
	raw := openRaw(t, e.dbPath)
	for _, u := range []struct{ id, tok string }{{e.userA, e.tokenA}, {e.userB, e.tokenB}} {
		for _, title := range []string{"alvo " + u.id, "origem " + u.id} {
			body, _ := json.Marshal(map[string]any{
				"title": title,
				"body":  "texto palavrachave [[alvo " + u.id + "]] ![i](zk:img/img" + u.id + ") ![d](zk:draw/dr" + u.id + ")",
				"tags":  []string{"t"},
			})
			if rec := e.do("POST", "/api/zettels", u.tok, bytes.NewReader(body)); rec.Code >= 300 {
				t.Fatalf("seed zettel: %d %s", rec.Code, rec.Body.String())
			}
		}
		mustExec(t, raw, `INSERT INTO zettels (id, user_id, title, created_at, updated_at, deleted_at) VALUES (?, ?, 'apagado', 1, 2, 3)`, "del"+u.id, u.id)
		mustExec(t, raw, `INSERT INTO images (id, user_id, mime, byte_len, data, created_at, orphaned_at) VALUES (?, ?, 'image/png', ?, ?, 1, 5)`, "img"+u.id, u.id, len(imgBytes), imgBytes)
		mustExec(t, raw, `INSERT INTO image_refs (image_id, zettel_id) SELECT ?, id FROM zettels WHERE user_id = ? AND deleted_at IS NULL`, "img"+u.id, u.id)
		if _, err := e.dRepo.Upsert(u.id, drawings.Drawing{
			ID: "dr" + u.id, Scene: scene, SVG: svg, ByteLen: int64(len(scene) + len(svg)), CreatedAt: 1, UpdatedAt: 2,
		}); err != nil {
			t.Fatal(err)
		}
		var zid string
		raw.QueryRow(`SELECT id FROM zettels WHERE user_id = ? AND deleted_at IS NULL LIMIT 1`, u.id).Scan(&zid)
		if _, _, err := e.posRepo.Upsert(u.id, []positions.Entry{{ID: zid, X: 10, Y: 20, UpdatedAt: 3}}, positions.ModeLWW, 4); err != nil {
			t.Fatal(err)
		}
		mustExec(t, raw, `INSERT INTO refresh_tokens (token, user_id, expires_at) VALUES (?, ?, 9)`, "rt"+u.id, u.id)
		mustExec(t, raw, `INSERT INTO webauthn_credentials (id, user_id, credential) VALUES (?, ?, '{}')`, "wa"+u.id, u.id)
		mustExec(t, raw, `INSERT INTO api_keys (key_hash, user_id, created_at) VALUES (?, ?, 1)`, "ak"+u.id, u.id)
		mustExec(t, raw, `INSERT INTO backup_keys (key_hash, user_id, created_at) VALUES (?, ?, 1)`, "bk"+u.id, u.id)
		mustExec(t, raw, `INSERT INTO invites (token, created_by, expires_at) VALUES (?, ?, 9)`, "inv"+u.id, u.id)
	}
}

func openRaw(t *testing.T, path string) *sql.DB {
	t.Helper()
	d, err := sql.Open("sqlite", path)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { d.Close() })
	return d
}

func mustExec(t *testing.T, d *sql.DB, q string, args ...any) {
	t.Helper()
	if _, err := d.Exec(q, args...); err != nil {
		t.Fatalf("%s: %v", q, err)
	}
}

func count(t *testing.T, d *sql.DB, q string, args ...any) int {
	t.Helper()
	var n int
	if err := d.QueryRow(q, args...).Scan(&n); err != nil {
		t.Fatalf("%s: %v", q, err)
	}
	return n
}

// download baixa o snapshot pela rota e grava num arquivo.
func (e *env) download(t *testing.T) string {
	t.Helper()
	rec := e.do("GET", "/api/export/sqlite", e.tokenA, nil)
	if rec.Code != 200 {
		t.Fatalf("export: %d %s", rec.Code, rec.Body.String())
	}
	if ct := rec.Header().Get("Content-Type"); ct != "application/vnd.sqlite3" {
		t.Fatalf("content-type %q", ct)
	}
	want := `attachment; filename="zettelkasten-alice-` + time.Now().Format("20060102") + `.db"`
	if cd := rec.Header().Get("Content-Disposition"); cd != want {
		t.Fatalf("content-disposition %q, want %q", cd, want)
	}
	path := filepath.Join(t.TempDir(), "snap.db")
	if err := os.WriteFile(path, rec.Body.Bytes(), 0o600); err != nil {
		t.Fatal(err)
	}
	return path
}

func TestSQLiteSnapshotHasOnlyOwnerData(t *testing.T) {
	e := newEnv(t, 1<<20)
	e.seedBoth(t)
	snap := openRaw(t, e.download(t))

	for _, q := range []string{
		`SELECT COUNT(*) FROM users WHERE id != ?`,
		`SELECT COUNT(*) FROM zettels WHERE user_id != ?`,
		`SELECT COUNT(*) FROM images WHERE user_id != ?`,
		`SELECT COUNT(*) FROM drawings WHERE user_id != ?`,
		`SELECT COUNT(*) FROM drawing_refs WHERE user_id != ?`,
		`SELECT COUNT(*) FROM positions WHERE user_id != ?`,
		`SELECT COUNT(*) FROM links WHERE source_id NOT IN (SELECT id FROM zettels WHERE user_id = ?)`,
		`SELECT COUNT(*) FROM image_refs WHERE zettel_id NOT IN (SELECT id FROM zettels WHERE user_id = ?)`,
	} {
		if n := count(t, snap, q, e.userA); n != 0 {
			t.Errorf("%s: %d foreign rows", q, n)
		}
	}
	for _, table := range []string{"refresh_tokens", "webauthn_credentials", "api_keys", "backup_keys", "invites"} {
		if n := count(t, snap, `SELECT COUNT(*) FROM `+table); n != 0 {
			t.Errorf("%s must be empty, has %d", table, n)
		}
	}

	// Conteúdo do dono presente: tombstone, órfão, links, refs, posição.
	checks := map[string]int{
		`SELECT COUNT(*) FROM zettels`:                              3,
		`SELECT COUNT(*) FROM zettels WHERE deleted_at IS NOT NULL`: 1,
		`SELECT COUNT(*) FROM links`:                                2,
		`SELECT COUNT(*) FROM image_refs`:                           2,
		`SELECT COUNT(*) FROM images WHERE orphaned_at = 5`:         1,
		`SELECT COUNT(*) FROM drawing_refs`:                         2,
		`SELECT COUNT(*) FROM positions`:                            1,
	}
	for q, want := range checks {
		if n := count(t, snap, q); n != want {
			t.Errorf("%s = %d, want %d", q, n, want)
		}
	}

	var data []byte
	var gotScene, gotSVG string
	snap.QueryRow(`SELECT data FROM images`).Scan(&data)
	snap.QueryRow(`SELECT scene, svg FROM drawings`).Scan(&gotScene, &gotSVG)
	if !bytes.Equal(data, imgBytes) || gotScene != scene || gotSVG != svg {
		t.Fatal("blobs must be byte-identical")
	}

	// FTS reconstruído pelos triggers.
	if n := count(t, snap, `SELECT COUNT(*) FROM zettels_fts WHERE zettels_fts MATCH 'palavrachave'`); n != 2 {
		t.Fatalf("fts match = %d, want 2", n)
	}

	// Login local com a mesma senha.
	var hash string
	snap.QueryRow(`SELECT password_hash FROM users`).Scan(&hash)
	if bcrypt.CompareHashAndPassword([]byte(hash), []byte("password-a")) != nil {
		t.Fatal("password hash must allow the same login")
	}
}

func TestSQLiteSnapshotOpensWithAPI(t *testing.T) {
	e := newEnv(t, 1<<20)
	e.seedBoth(t)
	path := e.download(t)
	if _, err := os.Stat(path + "-wal"); err == nil {
		t.Fatal("snapshot must be a single file")
	}
	d, err := db.Open(path)
	if err != nil {
		t.Fatalf("api must open the snapshot: %v", err)
	}
	d.Close()
}

// Banco criado antes do evolve(): user_id, is_public, settings e type entram
// por ALTER TABLE no fim da tabela, em outra ordem que a criação do zero.
func TestSQLiteSnapshotOldColumnOrder(t *testing.T) {
	live := filepath.Join(t.TempDir(), "old.db")
	raw := openRaw(t, live)
	mustExec(t, raw, `CREATE TABLE users (id TEXT PRIMARY KEY, username TEXT UNIQUE NOT NULL, password_hash TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'member', created_at INTEGER NOT NULL)`)
	mustExec(t, raw, `CREATE TABLE zettels (id TEXT PRIMARY KEY, title TEXT NOT NULL, body TEXT NOT NULL DEFAULT '', tags TEXT NOT NULL DEFAULT '[]', created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, deleted_at INTEGER)`)
	mustExec(t, raw, `CREATE TABLE links (source_id TEXT NOT NULL, target_id TEXT NOT NULL, PRIMARY KEY (source_id, target_id))`)
	raw.Close()

	d, err := db.Open(live)
	if err != nil {
		t.Fatal(err)
	}
	defer d.Close()
	mustExec(t, d, `INSERT INTO users (id, username, password_hash, created_at, settings) VALUES ('u', 'velho', 'h', 1, '{"a":1}')`)
	mustExec(t, d, `INSERT INTO zettels (id, user_id, title, body, tags, created_at, updated_at, is_public) VALUES ('z', 'u', 'T', 'B', '["x"]', 10, 20, 1)`)
	mustExec(t, d, `INSERT INTO links (source_id, target_id, type) VALUES ('z', 'z', 'parent-ref')`)

	dst := filepath.Join(t.TempDir(), "snap.db")
	if _, err := portability.WriteUserSnapshot(context.Background(), live, "u", dst); err != nil {
		t.Fatal(err)
	}
	snap := openRaw(t, dst)
	var userID, title, body, tags, settings, linkType string
	var created, updated, public int
	snap.QueryRow(`SELECT user_id, title, body, tags, created_at, updated_at, is_public FROM zettels`).
		Scan(&userID, &title, &body, &tags, &created, &updated, &public)
	snap.QueryRow(`SELECT settings FROM users`).Scan(&settings)
	snap.QueryRow(`SELECT type FROM links`).Scan(&linkType)
	if userID != "u" || title != "T" || body != "B" || tags != `["x"]` || created != 10 || updated != 20 || public != 1 {
		t.Fatalf("columns shifted: %q %q %q %q %d %d %d", userID, title, body, tags, created, updated, public)
	}
	if settings != `{"a":1}` || linkType != "parent-ref" {
		t.Fatalf("evolved columns lost: %q %q", settings, linkType)
	}
}

func TestSQLiteSnapshotViaBackupKey(t *testing.T) {
	e := newEnv(t, 1<<20)
	e.seed(t)
	key := strings.Repeat("ab", 32)
	raw := openRaw(t, e.dbPath)
	mustExec(t, raw, `INSERT INTO backup_keys (key_hash, user_id, created_at) VALUES (?, ?, 1)`, sha256Hex(key), e.userA)

	rec := e.doPublic("GET", "/api/backup/export?key="+key+"&format=sqlite")
	if rec.Code != 200 || rec.Header().Get("Content-Type") != "application/vnd.sqlite3" {
		t.Fatalf("backup export: %d %s", rec.Code, rec.Body.String())
	}
}

func TestSQLiteSnapshotRejectsAPIKey(t *testing.T) {
	e := newEnv(t, 1<<20)
	rec := e.do("GET", "/api/export/sqlite", "zk_"+strings.Repeat("0", 64), nil)
	if rec.Code != 401 {
		t.Fatalf("api key must get 401, got %d", rec.Code)
	}
}

func sha256Hex(s string) string {
	sum := sha256.Sum256([]byte(s))
	return hex.EncodeToString(sum[:])
}

func (e *env) doPublic(method, path string) *httptest.ResponseRecorder {
	rec := httptest.NewRecorder()
	e.srv.ServeHTTP(rec, httptest.NewRequest(method, path, nil))
	return rec
}
