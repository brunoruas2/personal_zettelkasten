package zettel

import (
	"database/sql"
	"encoding/json"
	"strings"

	"github.com/brunofullstack/zettelkasten/api/internal/models"
)

// Consultas usadas só pelo Service (MCP e operações no nível do usuário).

// ListRecent devolve os zettels vivos mais atualizados, com corpo.
func (r *Repository) ListRecent(userID string, limit int) ([]models.Zettel, error) {
	return r.ListRecentFiltered(userID, limit, TypeFilter{})
}

// ListRecentFiltered é o ListRecent restrito a um tipo e/ou nível.
func (r *Repository) ListRecentFiltered(userID string, limit int, f TypeFilter) ([]models.Zettel, error) {
	clause, extra := f.sql("z")
	args := append([]any{userID}, extra...)
	args = append(args, limit)
	rows, err := r.db.Query(`
		SELECT z.id, z.user_id, z.title, z.body, z.tags, z.created_at, z.updated_at, z.deleted_at
		FROM zettels z WHERE z.user_id = ? AND z.deleted_at IS NULL`+clause+`
		ORDER BY z.updated_at DESC LIMIT ?
	`, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return scanRows(rows)
}

// FindByTitleFold acha um zettel vivo cujo título é igual a title sem
// diferenciar maiúsculas (inclusive fora do ASCII, por isso a comparação é em
// Go), ignorando excludeID. Devolve nil quando não há.
func (r *Repository) FindByTitleFold(userID, title, excludeID string) (*models.Zettel, error) {
	rows, err := r.db.Query(`
		SELECT id, title FROM zettels WHERE user_id = ? AND deleted_at IS NULL AND id != ?
	`, userID, excludeID)
	if err != nil {
		return nil, err
	}
	var found string
	for rows.Next() {
		var id, t string
		if err := rows.Scan(&id, &t); err != nil {
			rows.Close()
			return nil, err
		}
		if strings.EqualFold(strings.TrimSpace(t), strings.TrimSpace(title)) {
			found = id
			break
		}
	}
	rows.Close()
	if found == "" {
		return nil, rows.Err()
	}
	return r.GetByID(userID, found)
}

type idBody struct {
	ID        string
	Body      string
	UpdatedAt int64
}

// BodiesContaining devolve id e corpo dos zettels vivos cujo corpo contém
// algum dos trechos (comparação exata, feita pelo SQLite).
func (r *Repository) BodiesContaining(userID string, needles ...string) ([]idBody, error) {
	if len(needles) == 0 {
		return nil, nil
	}
	conds := make([]string, len(needles))
	args := []any{userID}
	for i, n := range needles {
		conds[i] = "instr(body, ?) > 0"
		args = append(args, n)
	}
	rows, err := r.db.Query(`
		SELECT id, body, updated_at FROM zettels
		WHERE user_id = ? AND deleted_at IS NULL AND (`+strings.Join(conds, " OR ")+`)
	`, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []idBody
	for rows.Next() {
		var b idBody
		if err := rows.Scan(&b.ID, &b.Body, &b.UpdatedAt); err != nil {
			return nil, err
		}
		out = append(out, b)
	}
	return out, rows.Err()
}

// bodyUpdate é a reescrita de um corpo dentro da transação de renomeação.
type bodyUpdate struct {
	ID        string
	Body      string
	UpdatedAt int64
}

// RenameTx troca o título e grava os corpos reescritos numa transação só.
func (r *Repository) RenameTx(userID, id, title string, updatedAt int64, rewrites []bodyUpdate) error {
	tx, err := r.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback() //nolint:errcheck
	res, err := tx.Exec(`
		UPDATE zettels SET title = ?, updated_at = ? WHERE id = ? AND user_id = ? AND deleted_at IS NULL
	`, title, updatedAt, id, userID)
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return ErrNotFound
	}
	for _, b := range rewrites {
		if _, err := tx.Exec(`
			UPDATE zettels SET body = ?, updated_at = ? WHERE id = ? AND user_id = ? AND deleted_at IS NULL
		`, b.Body, b.UpdatedAt, b.ID, userID); err != nil {
			return err
		}
	}
	return tx.Commit()
}

// AllTags devolve as tags de cada zettel vivo do usuário.
func (r *Repository) AllTags(userID string) ([][]string, error) {
	rows, err := r.db.Query(`SELECT tags FROM zettels WHERE user_id = ? AND deleted_at IS NULL`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out [][]string
	for rows.Next() {
		var raw string
		if err := rows.Scan(&raw); err != nil {
			return nil, err
		}
		var tags []string
		_ = json.Unmarshal([]byte(raw), &tags)
		out = append(out, tags)
	}
	return out, rows.Err()
}

// LinkRef é uma ponta de link com o título do outro zettel.
type LinkRef struct {
	ID     string `json:"id"`
	Title  string `json:"title"`
	Parent bool   `json:"parent"`
}

// OutgoingLinks: zettels que id cita (Parent = escrito como [[^título]]).
func (r *Repository) OutgoingLinks(userID, id string) ([]LinkRef, error) {
	return r.linkRefs(`
		SELECT z.id, z.title, l.type FROM links l JOIN zettels z ON z.id = l.target_id
		WHERE l.source_id = ? AND z.user_id = ? AND z.deleted_at IS NULL ORDER BY z.title
	`, id, userID)
}

// IncomingLinks: zettels que citam id (Parent = id é pai deles).
func (r *Repository) IncomingLinks(userID, id string) ([]LinkRef, error) {
	return r.linkRefs(`
		SELECT z.id, z.title, l.type FROM links l JOIN zettels z ON z.id = l.source_id
		WHERE l.target_id = ? AND z.user_id = ? AND z.deleted_at IS NULL ORDER BY z.title
	`, id, userID)
}

func (r *Repository) linkRefs(q string, args ...any) ([]LinkRef, error) {
	rows, err := r.db.Query(q, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []LinkRef{}
	for rows.Next() {
		var l LinkRef
		var typ sql.NullString
		if err := rows.Scan(&l.ID, &l.Title, &typ); err != nil {
			return nil, err
		}
		l.Parent = typ.Valid && typ.String == "parent-ref"
		out = append(out, l)
	}
	return out, rows.Err()
}

// SearchFTS roda uma expressão MATCH já montada (sem acrescentar nada), em ordem
// de relevância, até limit resultados.
func (r *Repository) SearchFTS(userID, match string, limit int) ([]models.Zettel, error) {
	return r.SearchFTSFiltered(userID, match, limit, TypeFilter{})
}

// SearchFTSFiltered é o SearchFTS restrito a um tipo e/ou nível.
func (r *Repository) SearchFTSFiltered(userID, match string, limit int, f TypeFilter) ([]models.Zettel, error) {
	clause, extra := f.sql("z")
	args := []any{match, userID}
	args = append(args, extra...)
	args = append(args, limit)
	rows, err := r.db.Query(`
		SELECT z.id, z.user_id, z.title, z.body, z.tags, z.created_at, z.updated_at, z.deleted_at
		FROM zettels z
		JOIN zettels_fts fts ON z.rowid = fts.rowid
		WHERE zettels_fts MATCH ? AND z.user_id = ? AND z.deleted_at IS NULL`+clause+`
		ORDER BY rank LIMIT ?
	`, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return scanRows(rows)
}
