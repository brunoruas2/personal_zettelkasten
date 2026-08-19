package db

import (
	"database/sql"
	"fmt"

	_ "modernc.org/sqlite"
)

func Open(path string) (*sql.DB, error) {
	db, err := sql.Open("sqlite", path)
	if err != nil {
		return nil, fmt.Errorf("open db: %w", err)
	}

	if _, err := db.Exec(`
		PRAGMA journal_mode = WAL;
		PRAGMA foreign_keys = ON;
		PRAGMA busy_timeout = 5000;
	`); err != nil {
		return nil, fmt.Errorf("pragmas: %w", err)
	}

	if err := migrate(db); err != nil {
		return nil, fmt.Errorf("migrate: %w", err)
	}

	if err := evolve(db); err != nil {
		return nil, fmt.Errorf("evolve: %w", err)
	}

	return db, nil
}

// evolve applies additive schema changes to tables that already exist
// (ALTER TABLE ADD COLUMN). Safe to call on every boot.
func evolve(db *sql.DB) error {
	// Add user_id to zettels if migrated from pre-auth schema
	var hasUserID int
	if err := db.QueryRow(
		`SELECT COUNT(*) FROM pragma_table_info('zettels') WHERE name='user_id'`,
	).Scan(&hasUserID); err != nil {
		return err
	}
	if hasUserID == 0 {
		if _, err := db.Exec(
			`ALTER TABLE zettels ADD COLUMN user_id TEXT NOT NULL DEFAULT ''`,
		); err != nil {
			return fmt.Errorf("add user_id to zettels: %w", err)
		}
	}

	// Add settings column to users
	var hasSettings int
	if err := db.QueryRow(
		`SELECT COUNT(*) FROM pragma_table_info('users') WHERE name='settings'`,
	).Scan(&hasSettings); err != nil {
		return err
	}
	if hasSettings == 0 {
		if _, err := db.Exec(
			`ALTER TABLE users ADD COLUMN settings TEXT NOT NULL DEFAULT '{}'`,
		); err != nil {
			return fmt.Errorf("add settings to users: %w", err)
		}
	}

	// Add is_public to zettels
	var hasIsPublic int
	if err := db.QueryRow(
		`SELECT COUNT(*) FROM pragma_table_info('zettels') WHERE name='is_public'`,
	).Scan(&hasIsPublic); err != nil {
		return err
	}
	if hasIsPublic == 0 {
		if _, err := db.Exec(
			`ALTER TABLE zettels ADD COLUMN is_public INTEGER NOT NULL DEFAULT 0`,
		); err != nil {
			return fmt.Errorf("add is_public to zettels: %w", err)
		}
	}

	// Add type to links (nullable — NULL means plain/child link, 'parent-ref' means [[^Title]])
	var hasLinkType int
	if err := db.QueryRow(
		`SELECT COUNT(*) FROM pragma_table_info('links') WHERE name='type'`,
	).Scan(&hasLinkType); err != nil {
		return err
	}
	if hasLinkType == 0 {
		if _, err := db.Exec(
			`ALTER TABLE links ADD COLUMN type TEXT`,
		); err != nil {
			return fmt.Errorf("add type to links: %w", err)
		}
	}

	return nil
}

func migrate(db *sql.DB) error {
	_, err := db.Exec(`
		CREATE TABLE IF NOT EXISTS backup_keys (
			key_hash   TEXT PRIMARY KEY,
			user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
			created_at INTEGER NOT NULL
		);

		CREATE TABLE IF NOT EXISTS users (
			id            TEXT PRIMARY KEY,
			username      TEXT UNIQUE NOT NULL,
			password_hash TEXT NOT NULL,
			role          TEXT NOT NULL DEFAULT 'member',
			created_at    INTEGER NOT NULL
		);

		CREATE TABLE IF NOT EXISTS invites (
			token      TEXT PRIMARY KEY,
			created_by TEXT NOT NULL REFERENCES users(id),
			used_by    TEXT REFERENCES users(id),
			expires_at INTEGER NOT NULL
		);

		CREATE TABLE IF NOT EXISTS refresh_tokens (
			token      TEXT PRIMARY KEY,
			user_id    TEXT NOT NULL REFERENCES users(id),
			expires_at INTEGER NOT NULL
		);

		CREATE TABLE IF NOT EXISTS webauthn_credentials (
			id         TEXT PRIMARY KEY,
			user_id    TEXT NOT NULL REFERENCES users(id),
			name       TEXT NOT NULL DEFAULT 'Passkey',
			credential TEXT NOT NULL
		);

		CREATE TABLE IF NOT EXISTS zettels (
			id         TEXT PRIMARY KEY,
			user_id    TEXT NOT NULL REFERENCES users(id),
			title      TEXT NOT NULL,
			body       TEXT NOT NULL DEFAULT '',
			tags       TEXT NOT NULL DEFAULT '[]',
			created_at INTEGER NOT NULL,
			updated_at INTEGER NOT NULL,
			deleted_at INTEGER
		);

		CREATE TABLE IF NOT EXISTS links (
			source_id TEXT NOT NULL,
			target_id TEXT NOT NULL,
			PRIMARY KEY (source_id, target_id)
		);

		CREATE VIRTUAL TABLE IF NOT EXISTS zettels_fts USING fts5(
			title, body, tags,
			content='zettels',
			content_rowid='rowid'
		);

		CREATE TRIGGER IF NOT EXISTS zettels_ai AFTER INSERT ON zettels BEGIN
			INSERT INTO zettels_fts(rowid, title, body, tags)
			VALUES (new.rowid, new.title, new.body, new.tags);
		END;

		CREATE TRIGGER IF NOT EXISTS zettels_au AFTER UPDATE ON zettels BEGIN
			INSERT INTO zettels_fts(zettels_fts, rowid, title, body, tags)
			VALUES ('delete', old.rowid, old.title, old.body, old.tags);
			INSERT INTO zettels_fts(rowid, title, body, tags)
			VALUES (new.rowid, new.title, new.body, new.tags);
		END;

		CREATE TRIGGER IF NOT EXISTS zettels_ad AFTER DELETE ON zettels BEGIN
			INSERT INTO zettels_fts(zettels_fts, rowid, title, body, tags)
			VALUES ('delete', old.rowid, old.title, old.body, old.tags);
		END;

		-- Imagens ficam em tabela própria (nunca coluna em zettels): os triggers
		-- zettels_* acima copiam title/body/tags para o índice FTS5 em todo
		-- INSERT/UPDATE, e um BLOB ali dentro seria arrastado junto.
		-- PK composta porque o id é o sha256 do conteúdo: dois usuários com a
		-- mesma imagem colidiriam numa PK simples.
		CREATE TABLE IF NOT EXISTS images (
			id          TEXT NOT NULL,
			user_id     TEXT NOT NULL REFERENCES users(id),
			mime        TEXT NOT NULL,
			width       INTEGER NOT NULL DEFAULT 0,
			height      INTEGER NOT NULL DEFAULT 0,
			byte_len    INTEGER NOT NULL,
			data        BLOB NOT NULL,
			created_at  INTEGER NOT NULL,
			orphaned_at INTEGER,
			PRIMARY KEY (user_id, id)
		);

		CREATE INDEX IF NOT EXISTS idx_images_orphaned ON images(orphaned_at);

		CREATE TABLE IF NOT EXISTS image_refs (
			image_id  TEXT NOT NULL,
			zettel_id TEXT NOT NULL,
			PRIMARY KEY (image_id, zettel_id)
		);

		CREATE INDEX IF NOT EXISTS idx_image_refs_zettel ON image_refs(zettel_id);
	`)
	return err
}
