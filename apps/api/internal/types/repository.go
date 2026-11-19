package types

import (
	"database/sql"
	"encoding/json"
	"errors"
	"strings"
)

// Repository guarda tipos e atribuições. Tudo por usuário (user_id na PK).
type Repository struct {
	db *sql.DB
}

func NewRepository(db *sql.DB) *Repository { return &Repository{db: db} }

const typeCols = `id, name, slug, icon, color, template, protected_sections, levels, counts_progress, updated_at, deleted_at`

type scanner interface {
	Scan(dest ...any) error
}

func scanType(s scanner) (*Type, error) {
	var (
		t         Type
		prot, lvl string
		counts    int
		deleted   sql.NullInt64
	)
	if err := s.Scan(&t.ID, &t.Name, &t.Slug, &t.Icon, &t.Color, &t.Template, &prot, &lvl, &counts, &t.UpdatedAt, &deleted); err != nil {
		return nil, err
	}
	t.CountsProgress = counts != 0
	if deleted.Valid {
		d := deleted.Int64
		t.DeletedAt = &d
	}
	if err := json.Unmarshal([]byte(prot), &t.ProtectedSections); err != nil || t.ProtectedSections == nil {
		t.ProtectedSections = []string{}
	}
	if err := json.Unmarshal([]byte(lvl), &t.Levels); err != nil || t.Levels == nil {
		t.Levels = []Level{}
	}
	return &t, nil
}

// --- tipos ---

// Since devolve os tipos gravados no servidor em synced_at >= since, apagados
// inclusive. O `>=` repete as linhas do último milissegundo, o que é
// inofensivo (o merge do cliente é idempotente).
func (r *Repository) Since(userID string, since int64) ([]Type, error) {
	rows, err := r.db.Query(`SELECT `+typeCols+` FROM zettel_types WHERE user_id = ? AND synced_at >= ? ORDER BY id`, userID, since)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return collectTypes(rows)
}

// List devolve os tipos vivos, por nome.
func (r *Repository) List(userID string) ([]Type, error) {
	rows, err := r.db.Query(`SELECT `+typeCols+` FROM zettel_types WHERE user_id = ? AND deleted_at IS NULL ORDER BY name COLLATE NOCASE`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return collectTypes(rows)
}

func collectTypes(rows *sql.Rows) ([]Type, error) {
	out := []Type{}
	for rows.Next() {
		t, err := scanType(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *t)
	}
	return out, rows.Err()
}

// Get devolve o tipo vivo ou ErrNotFound.
func (r *Repository) Get(userID, id string) (*Type, error) {
	t, err := scanType(r.db.QueryRow(`SELECT `+typeCols+` FROM zettel_types WHERE user_id = ? AND id = ? AND deleted_at IS NULL`, userID, id))
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrNotFound
	}
	return t, err
}

// Resolve acha um tipo vivo por id ou por slug.
func (r *Repository) Resolve(userID, ref string) (*Type, error) {
	ref = strings.TrimSpace(ref)
	t, err := scanType(r.db.QueryRow(
		`SELECT `+typeCols+` FROM zettel_types WHERE user_id = ? AND deleted_at IS NULL AND (id = ? OR slug = ?) ORDER BY (id = ?) DESC LIMIT 1`,
		userID, ref, strings.ToLower(ref), ref))
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrNotFound
	}
	return t, err
}

// Upsert grava o lote numa transação, last-write-wins por updated_at do
// cliente (`excluded.updated_at > atual`). Devolve os ids ignorados (versão
// igual ou mais antiga, ou tipo já apagado: apagar é definitivo). Slug em uso
// por outro tipo vivo = ErrSlugTaken; passar de MaxTypes = ErrLimit.
func (r *Repository) Upsert(userID string, in []Type, now int64) (ignored []string, err error) {
	tx, err := r.db.Begin()
	if err != nil {
		return nil, err
	}
	defer tx.Rollback() //nolint:errcheck

	ins, err := tx.Prepare(`
		INSERT INTO zettel_types
			(user_id, id, name, slug, icon, color, template, protected_sections, levels, counts_progress, updated_at, synced_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		ON CONFLICT (user_id, id) DO UPDATE SET
			name = excluded.name, slug = excluded.slug, icon = excluded.icon, color = excluded.color,
			template = excluded.template, protected_sections = excluded.protected_sections,
			levels = excluded.levels, counts_progress = excluded.counts_progress,
			updated_at = excluded.updated_at, synced_at = excluded.synced_at
		WHERE excluded.updated_at > zettel_types.updated_at AND zettel_types.deleted_at IS NULL`)
	if err != nil {
		return nil, err
	}
	defer ins.Close()

	ignored = []string{}
	for i := range in {
		t := &in[i]
		if err := t.Validate(); err != nil {
			return nil, err
		}
		var exists int
		if err := tx.QueryRow(`SELECT COUNT(*) FROM zettel_types WHERE user_id = ? AND id = ?`, userID, t.ID).Scan(&exists); err != nil {
			return nil, err
		}
		if exists == 0 {
			var live int
			if err := tx.QueryRow(`SELECT COUNT(*) FROM zettel_types WHERE user_id = ? AND deleted_at IS NULL`, userID).Scan(&live); err != nil {
				return nil, err
			}
			if live >= MaxTypes {
				return nil, ErrLimit
			}
		}
		prot, _ := json.Marshal(t.ProtectedSections)
		lvl, _ := json.Marshal(t.Levels)
		counts := 0
		if t.CountsProgress {
			counts = 1
		}
		res, err := ins.Exec(userID, t.ID, t.Name, t.Slug, t.Icon, t.Color, t.Template, string(prot), string(lvl), counts, t.UpdatedAt, now)
		if err != nil {
			if strings.Contains(err.Error(), "UNIQUE constraint failed") {
				return nil, ErrSlugTaken
			}
			return nil, err
		}
		if n, _ := res.RowsAffected(); n == 0 {
			ignored = append(ignored, t.ID)
		}
	}
	return ignored, tx.Commit()
}

// Delete marca o tipo como apagado e, na mesma transação, apaga as atribuições
// dele (com synced_at novo, para os outros aparelhos saberem pelo delta). Nenhum
// zettel é alterado. Devolve os ids dos zettels que ficaram sem tipo.
func (r *Repository) Delete(userID, id string, now int64) (affected []string, err error) {
	tx, err := r.db.Begin()
	if err != nil {
		return nil, err
	}
	defer tx.Rollback() //nolint:errcheck

	res, err := tx.Exec(`UPDATE zettel_types SET deleted_at = ?, synced_at = ? WHERE user_id = ? AND id = ? AND deleted_at IS NULL`, now, now, userID, id)
	if err != nil {
		return nil, err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return nil, ErrNotFound
	}
	rows, err := tx.Query(`SELECT zettel_id FROM zettel_type_assignments WHERE user_id = ? AND type_id = ? AND deleted_at IS NULL`, userID, id)
	if err != nil {
		return nil, err
	}
	affected = []string{}
	for rows.Next() {
		var z string
		if err := rows.Scan(&z); err != nil {
			rows.Close()
			return nil, err
		}
		affected = append(affected, z)
	}
	rows.Close()
	if _, err := tx.Exec(`UPDATE zettel_type_assignments SET deleted_at = ?, synced_at = ? WHERE user_id = ? AND type_id = ? AND deleted_at IS NULL`, now, now, userID, id); err != nil {
		return nil, err
	}
	return affected, tx.Commit()
}

// ReleaseZettel marca como apagada a atribuição de um zettel que foi apagado
// (os outros aparelhos a descartam pelo delta). Sem atribuição, não faz nada.
func (r *Repository) ReleaseZettel(userID, zettelID string, now int64) error {
	_, err := r.db.Exec(`UPDATE zettel_type_assignments SET deleted_at = ?, synced_at = ? WHERE user_id = ? AND zettel_id = ? AND deleted_at IS NULL`, now, now, userID, zettelID)
	return err
}

// CountUsing devolve quantos zettels vivos usam o tipo (para os avisos da UI e do MCP).
func (r *Repository) CountUsing(userID, typeID string) (int, error) {
	var n int
	err := r.db.QueryRow(`SELECT COUNT(*) FROM zettel_type_assignments WHERE user_id = ? AND type_id = ? AND deleted_at IS NULL`, userID, typeID).Scan(&n)
	return n, err
}

// --- atribuições ---

// AssignmentsSince devolve as atribuições com synced_at >= since, apagadas inclusive.
func (r *Repository) AssignmentsSince(userID string, since int64) ([]Assignment, error) {
	rows, err := r.db.Query(`
		SELECT zettel_id, type_id, level, updated_at, deleted_at FROM zettel_type_assignments
		WHERE user_id = ? AND synced_at >= ? ORDER BY zettel_id`, userID, since)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Assignment{}
	for rows.Next() {
		a, err := scanAssignment(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *a)
	}
	return out, rows.Err()
}

func scanAssignment(s scanner) (*Assignment, error) {
	var (
		a       Assignment
		deleted sql.NullInt64
	)
	if err := s.Scan(&a.ZettelID, &a.TypeID, &a.Level, &a.UpdatedAt, &deleted); err != nil {
		return nil, err
	}
	if deleted.Valid {
		d := deleted.Int64
		a.DeletedAt = &d
	}
	return &a, nil
}

// Assignment devolve a atribuição viva do zettel; nil quando não há.
func (r *Repository) Assignment(userID, zettelID string) (*Assignment, error) {
	a, err := scanAssignment(r.db.QueryRow(`
		SELECT zettel_id, type_id, level, updated_at, deleted_at FROM zettel_type_assignments
		WHERE user_id = ? AND zettel_id = ? AND deleted_at IS NULL`, userID, zettelID))
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	return a, err
}

// AssignmentsFor devolve as atribuições vivas de um conjunto de zettels, por id.
func (r *Repository) AssignmentsFor(userID string, ids []string) (map[string]Assignment, error) {
	out := map[string]Assignment{}
	for i := 0; i < len(ids); i += 500 {
		end := i + 500
		if end > len(ids) {
			end = len(ids)
		}
		chunk := ids[i:end]
		args := make([]any, 0, len(chunk)+1)
		args = append(args, userID)
		for _, id := range chunk {
			args = append(args, id)
		}
		rows, err := r.db.Query(`
			SELECT zettel_id, type_id, level, updated_at, deleted_at FROM zettel_type_assignments
			WHERE user_id = ? AND deleted_at IS NULL AND zettel_id IN (`+placeholders(len(chunk))+`)`, args...)
		if err != nil {
			return nil, err
		}
		for rows.Next() {
			a, err := scanAssignment(rows)
			if err != nil {
				rows.Close()
				return nil, err
			}
			out[a.ZettelID] = *a
		}
		rows.Close()
	}
	return out, nil
}

func placeholders(n int) string {
	if n == 0 {
		return ""
	}
	return strings.TrimSuffix(strings.Repeat("?,", n), ",")
}

// UpsertAssignments grava o lote numa transação, last-write-wins por
// updated_at do cliente. Item com deleted=true vira tombstone ("sem tipo"). O
// tipo precisa estar vivo e o nível valer para ele (senão ErrInvalid, e nada
// do lote é gravado). Devolve em skipped os ids que não são zettels vivos do
// usuário: a atribuição de um zettel recém-criado pode chegar antes do próprio
// zettel, e o cliente a mantém pendente.
func (r *Repository) UpsertAssignments(userID string, in []Assignment, now int64) (skipped []string, err error) {
	tx, err := r.db.Begin()
	if err != nil {
		return nil, err
	}
	defer tx.Rollback() //nolint:errcheck

	cache := map[string]*Type{}
	typeOf := func(id string) (*Type, error) {
		if t, ok := cache[id]; ok {
			return t, nil
		}
		t, err := scanType(tx.QueryRow(`SELECT `+typeCols+` FROM zettel_types WHERE user_id = ? AND id = ? AND deleted_at IS NULL`, userID, id))
		if errors.Is(err, sql.ErrNoRows) {
			return nil, invalid("tipo %q inexistente ou apagado", id)
		}
		if err != nil {
			return nil, err
		}
		cache[id] = t
		return t, nil
	}

	skipped = []string{}
	for _, a := range in {
		if !idRE.MatchString(a.ZettelID) {
			return nil, invalid("id de zettel inválido")
		}
		if a.UpdatedAt <= 0 {
			return nil, invalid("updated_at é obrigatório")
		}
		var alive int
		if err := tx.QueryRow(`SELECT COUNT(*) FROM zettels WHERE user_id = ? AND id = ? AND deleted_at IS NULL`, userID, a.ZettelID).Scan(&alive); err != nil {
			return nil, err
		}
		if alive == 0 {
			skipped = append(skipped, a.ZettelID)
			continue
		}
		typeID, level := a.TypeID, a.Level
		var deletedAt any
		if a.DeletedAt != nil {
			// Tombstone: "sem tipo". O tipo e o nível não importam.
			deletedAt = now
			typeID, level = a.TypeID, ""
		} else {
			t, err := typeOf(a.TypeID)
			if err != nil {
				return nil, err
			}
			if err := t.ValidateLevel(level); err != nil {
				return nil, err
			}
		}
		if _, err := tx.Exec(`
			INSERT INTO zettel_type_assignments (user_id, zettel_id, type_id, level, updated_at, synced_at, deleted_at)
			VALUES (?, ?, ?, ?, ?, ?, ?)
			ON CONFLICT (user_id, zettel_id) DO UPDATE SET
				type_id = excluded.type_id, level = excluded.level,
				updated_at = excluded.updated_at, synced_at = excluded.synced_at, deleted_at = excluded.deleted_at
			WHERE excluded.updated_at > zettel_type_assignments.updated_at`,
			userID, a.ZettelID, typeID, level, a.UpdatedAt, now, deletedAt); err != nil {
			return nil, err
		}
	}
	return skipped, tx.Commit()
}
