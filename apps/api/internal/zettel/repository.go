package zettel

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"github.com/brunofullstack/zettelkasten/api/internal/models"
)

type Repository struct {
	db *sql.DB
}

func NewRepository(db *sql.DB) *Repository {
	return &Repository{db: db}
}

func (r *Repository) List(userID string, since int64, query string) ([]models.Zettel, error) {
	var (
		rows *sql.Rows
		err  error
	)
	switch {
	case query != "":
		rows, err = r.db.Query(`
			SELECT z.id, z.user_id, z.title, z.body, z.tags, z.created_at, z.updated_at, z.deleted_at
			FROM zettels z
			JOIN zettels_fts fts ON z.rowid = fts.rowid
			WHERE zettels_fts MATCH ? AND z.user_id = ? AND z.deleted_at IS NULL
			ORDER BY rank
		`, query+"*", userID)
	case since > 0:
		rows, err = r.db.Query(`
			SELECT id, user_id, title, body, tags, created_at, updated_at, deleted_at
			FROM zettels WHERE user_id = ? AND updated_at > ? ORDER BY updated_at DESC
		`, userID, since)
	default:
		rows, err = r.db.Query(`
			SELECT id, user_id, title, body, tags, created_at, updated_at, deleted_at
			FROM zettels WHERE user_id = ? AND deleted_at IS NULL ORDER BY updated_at DESC
		`, userID)
	}
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return scanRows(rows)
}

func (r *Repository) GetByID(userID, id string) (*models.Zettel, error) {
	row := r.db.QueryRow(`
		SELECT id, user_id, title, body, tags, created_at, updated_at, deleted_at
		FROM zettels WHERE id = ? AND user_id = ? AND deleted_at IS NULL
	`, id, userID)
	z, err := scanRow(row)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	return z, err
}

func (r *Repository) Create(z *models.Zettel) error {
	tags, err := json.Marshal(z.Tags)
	if err != nil {
		return err
	}
	_, err = r.db.Exec(`
		INSERT INTO zettels (id, user_id, title, body, tags, created_at, updated_at)
		VALUES (?, ?, ?, ?, ?, ?, ?)
	`, z.ID, z.UserID, z.Title, z.Body, string(tags), z.CreatedAt, z.UpdatedAt)
	return err
}

func (r *Repository) Update(z *models.Zettel) error {
	tags, err := json.Marshal(z.Tags)
	if err != nil {
		return err
	}
	res, err := r.db.Exec(`
		UPDATE zettels SET title=?, body=?, tags=?, updated_at=?
		WHERE id=? AND user_id=? AND deleted_at IS NULL
	`, z.Title, z.Body, string(tags), z.UpdatedAt, z.ID, z.UserID)
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return fmt.Errorf("not found")
	}
	return nil
}

func (r *Repository) Delete(userID, id string, now int64) error {
	res, err := r.db.Exec(`
		UPDATE zettels SET deleted_at=?, updated_at=? WHERE id=? AND user_id=? AND deleted_at IS NULL
	`, now, now, id, userID)
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return fmt.Errorf("not found")
	}
	return nil
}

func (r *Repository) UpsertLinks(sourceID string, links []models.Link) error {
	tx, err := r.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	if _, err := tx.Exec(`DELETE FROM links WHERE source_id = ?`, sourceID); err != nil {
		return err
	}
	for _, l := range links {
		var typeVal interface{}
		if l.Type != "" {
			typeVal = l.Type
		}
		if _, err := tx.Exec(
			`INSERT OR IGNORE INTO links (source_id, target_id, type) VALUES (?, ?, ?)`,
			sourceID, l.TargetID, typeVal,
		); err != nil {
			return err
		}
	}
	return tx.Commit()
}

func (r *Repository) GetBacklinks(userID, targetID string) ([]models.Zettel, error) {
	rows, err := r.db.Query(`
		SELECT z.id, z.user_id, z.title, z.body, z.tags, z.created_at, z.updated_at, z.deleted_at
		FROM zettels z
		JOIN links l ON l.source_id = z.id
		WHERE l.target_id = ? AND z.user_id = ? AND z.deleted_at IS NULL
	`, targetID, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return scanRows(rows)
}

func (r *Repository) GetAllLinks(userID string) ([]models.Link, error) {
	rows, err := r.db.Query(`
		SELECT l.source_id, l.target_id, l.type FROM links l
		JOIN zettels z ON z.id = l.source_id
		WHERE z.user_id = ? AND z.deleted_at IS NULL
	`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var links []models.Link
	for rows.Next() {
		var l models.Link
		var typ sql.NullString
		if err := rows.Scan(&l.SourceID, &l.TargetID, &typ); err != nil {
			return nil, err
		}
		if typ.Valid {
			l.Type = typ.String
		}
		links = append(links, l)
	}
	if links == nil {
		links = []models.Link{}
	}
	return links, rows.Err()
}

func (r *Repository) FindByTitle(userID, title string) (*models.Zettel, error) {
	row := r.db.QueryRow(`
		SELECT id, user_id, title, body, tags, created_at, updated_at, deleted_at
		FROM zettels WHERE title = ? AND user_id = ? AND deleted_at IS NULL LIMIT 1
	`, title, userID)
	z, err := scanRow(row)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	return z, err
}

// parsedLink is a title extracted from a [[wiki link]], plus whether it was
// written as [[^Title]] (the referenced zettel is the parent of this one).
type parsedLink struct {
	title       string
	isParentRef bool
}

// parseLinkTitles extrai títulos de [[wiki links]] do corpo do zettel.
func parseLinkTitles(body string) []parsedLink {
	var links []parsedLink
	for {
		start := strings.Index(body, "[[")
		if start == -1 {
			break
		}
		end := strings.Index(body[start:], "]]")
		if end == -1 {
			break
		}
		inner := body[start+2 : start+end]
		if pipeIdx := strings.Index(inner, "|"); pipeIdx != -1 {
			inner = inner[:pipeIdx]
		}
		isParentRef := strings.HasPrefix(inner, "^")
		title := inner
		if isParentRef {
			title = inner[1:]
		}
		if title != "" {
			links = append(links, parsedLink{title: title, isParentRef: isParentRef})
		}
		body = body[start+end+2:]
	}
	return links
}

// --- scan helpers ---

func scanRow(row *sql.Row) (*models.Zettel, error) {
	var z models.Zettel
	var tagsJSON string
	var deletedAt sql.NullInt64
	if err := row.Scan(&z.ID, &z.UserID, &z.Title, &z.Body, &tagsJSON, &z.CreatedAt, &z.UpdatedAt, &deletedAt); err != nil {
		return nil, err
	}
	if err := json.Unmarshal([]byte(tagsJSON), &z.Tags); err != nil || z.Tags == nil {
		z.Tags = []string{}
	}
	if deletedAt.Valid {
		z.DeletedAt = &deletedAt.Int64
	}
	return &z, nil
}

func scanRows(rows *sql.Rows) ([]models.Zettel, error) {
	var zettels []models.Zettel
	for rows.Next() {
		var z models.Zettel
		var tagsJSON string
		var deletedAt sql.NullInt64
		if err := rows.Scan(&z.ID, &z.UserID, &z.Title, &z.Body, &tagsJSON, &z.CreatedAt, &z.UpdatedAt, &deletedAt); err != nil {
			return nil, err
		}
		if err := json.Unmarshal([]byte(tagsJSON), &z.Tags); err != nil || z.Tags == nil {
			z.Tags = []string{}
		}
		if deletedAt.Valid {
			z.DeletedAt = &deletedAt.Int64
		}
		zettels = append(zettels, z)
	}
	if zettels == nil {
		zettels = []models.Zettel{}
	}
	return zettels, rows.Err()
}

// BulkImport imports zettels with per-zettel isolation: each zettel succeeds or
// fails independently. Import wins when input.updated_at > existing.updated_at.
// Returns the zettels that were actually inserted/updated (for link rebuilding).
func (r *Repository) BulkImport(userID string, zettels []models.Zettel) (imported, skipped int, done []models.Zettel, errs []string, err error) {
	now := time.Now().UnixMilli()

	for _, z := range zettels {
		if z.Title == "" {
			errs = append(errs, fmt.Sprintf("id=%s: título vazio", z.ID))
			continue
		}
		if z.Tags == nil {
			z.Tags = []string{}
		}
		tagsJSON, _ := json.Marshal(z.Tags)

		var existingUpdatedAt int64
		var existingDeletedAt sql.NullInt64
		scanErr := r.db.QueryRow(
			`SELECT updated_at, deleted_at FROM zettels WHERE id = ? AND user_id = ?`,
			z.ID, userID,
		).Scan(&existingUpdatedAt, &existingDeletedAt)

		if scanErr == sql.ErrNoRows {
			if z.CreatedAt == 0 {
				z.CreatedAt = now
			}
			if z.UpdatedAt == 0 {
				z.UpdatedAt = now
			}
			if z.ID == "" {
				z.ID = fmt.Sprintf("%d", now)
			}
			_, insErr := r.db.Exec(
				`INSERT INTO zettels (id, user_id, title, body, tags, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
				z.ID, userID, z.Title, z.Body, string(tagsJSON), z.CreatedAt, z.UpdatedAt,
			)
			if insErr != nil {
				errs = append(errs, fmt.Sprintf(`"%s": %s`, z.Title, insErr.Error()))
				continue
			}
			imported++
			done = append(done, z)
		} else if scanErr == nil {
			if z.UpdatedAt <= existingUpdatedAt {
				skipped++
				if existingDeletedAt.Valid {
					errs = append(errs, fmt.Sprintf(`"%s" ignorado: foi deletado após a data deste backup — delete o zettel permanentemente no banco ou use um backup mais recente`, z.Title))
				}
				continue
			}
			_, updErr := r.db.Exec(
				`UPDATE zettels SET title=?, body=?, tags=?, updated_at=?, deleted_at=NULL WHERE id=? AND user_id=?`,
				z.Title, z.Body, string(tagsJSON), z.UpdatedAt, z.ID, userID,
			)
			if updErr != nil {
				errs = append(errs, fmt.Sprintf(`"%s": %s`, z.Title, updErr.Error()))
				continue
			}
			imported++
			done = append(done, z)
		} else {
			errs = append(errs, fmt.Sprintf("id=%s: %s", z.ID, scanErr.Error()))
		}
	}

	return imported, skipped, done, errs, nil
}
