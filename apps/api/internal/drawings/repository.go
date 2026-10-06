package drawings

import (
	"database/sql"
	"fmt"
)

// OrphanGraceMillis é a carência entre um desenho perder a última referência e
// ser apagado de fato. Um device offline pode ter um zettel novo que referencia
// o desenho e ainda não ter sincronizado — para o servidor ele já tem 0 refs.
const OrphanGraceMillis int64 = 30 * 24 * 60 * 60 * 1000

// Drawing é o desenho completo, como trafega em GET/PUT /api/drawings/{id}.
// Timestamps em milissegundos Unix, como o resto da API.
type Drawing struct {
	ID        string `json:"id"`
	Scene     string `json:"scene"`
	SVG       string `json:"svg"`
	ByteLen   int64  `json:"byte_len"`
	Width     int    `json:"width"`
	Height    int    `json:"height"`
	CreatedAt int64  `json:"created_at"`
	UpdatedAt int64  `json:"updated_at"`
}

// ManifestEntry é o suficiente para o pull decidir o que baixar, sem a cena.
type ManifestEntry struct {
	ID        string `json:"id"`
	UpdatedAt int64  `json:"updated_at"`
	ByteLen   int64  `json:"byte_len"`
}

type Repository struct {
	db *sql.DB
}

func NewRepository(db *sql.DB) *Repository {
	return &Repository{db: db}
}

// Upsert grava o desenho com last-write-wins resolvido no SQL: a escrita só
// vence se `updated_at` for estritamente maior que o armazenado. Reenviar o
// mesmo desenho, ou fora de ordem, não regride nada. Devolve se a linha mudou.
func (r *Repository) Upsert(userID string, d Drawing) (bool, error) {
	res, err := r.db.Exec(`
		INSERT INTO drawings (id, user_id, scene, svg, byte_len, width, height, created_at, updated_at, orphaned_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)
		ON CONFLICT (user_id, id) DO UPDATE SET
			scene       = excluded.scene,
			svg         = excluded.svg,
			byte_len    = excluded.byte_len,
			width       = excluded.width,
			height      = excluded.height,
			updated_at  = excluded.updated_at,
			orphaned_at = NULL
		WHERE excluded.updated_at > drawings.updated_at
	`, d.ID, userID, d.Scene, d.SVG, d.ByteLen, d.Width, d.Height, d.CreatedAt, d.UpdatedAt)
	if err != nil {
		return false, err
	}
	n, _ := res.RowsAffected()
	return n > 0, nil
}

// ByteLen devolve o tamanho gravado de um desenho (0 se não existir). Serve ao
// cálculo da quota: regravar o mesmo id substitui, não soma.
func (r *Repository) ByteLen(userID, id string) (int64, error) {
	var n int64
	err := r.db.QueryRow(
		`SELECT byte_len FROM drawings WHERE user_id = ? AND id = ?`, userID, id,
	).Scan(&n)
	if err == sql.ErrNoRows {
		return 0, nil
	}
	return n, err
}

// Get devolve o desenho completo. É um dos dois únicos lugares que leem a
// coluna scene (o outro é o export ZIP em portability); nunca SELECT *.
func (r *Repository) Get(userID, id string) (*Drawing, error) {
	var d Drawing
	err := r.db.QueryRow(`
		SELECT id, scene, svg, byte_len, width, height, created_at, updated_at
		FROM drawings WHERE user_id = ? AND id = ?
	`, userID, id).Scan(&d.ID, &d.Scene, &d.SVG, &d.ByteLen, &d.Width, &d.Height, &d.CreatedAt, &d.UpdatedAt)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &d, nil
}

// ListAll devolve todos os desenhos do usuário, com a cena. Só o export ZIP usa.
func (r *Repository) ListAll(userID string) ([]Drawing, error) {
	rows, err := r.db.Query(`
		SELECT id, scene, svg, byte_len, width, height, created_at, updated_at
		FROM drawings WHERE user_id = ? ORDER BY created_at
	`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := []Drawing{}
	for rows.Next() {
		var d Drawing
		if err := rows.Scan(&d.ID, &d.Scene, &d.SVG, &d.ByteLen, &d.Width, &d.Height, &d.CreatedAt, &d.UpdatedAt); err != nil {
			return nil, err
		}
		out = append(out, d)
	}
	return out, rows.Err()
}

// Manifest lista id, updated_at e tamanho de todos os desenhos do usuário.
func (r *Repository) Manifest(userID string) ([]ManifestEntry, error) {
	rows, err := r.db.Query(`
		SELECT id, updated_at, byte_len
		FROM drawings WHERE user_id = ? ORDER BY updated_at DESC
	`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	entries := []ManifestEntry{}
	for rows.Next() {
		var e ManifestEntry
		if err := rows.Scan(&e.ID, &e.UpdatedAt, &e.ByteLen); err != nil {
			return nil, err
		}
		entries = append(entries, e)
	}
	return entries, rows.Err()
}

// UsedBytes soma o espaço ocupado pelos desenhos do usuário.
func (r *Repository) UsedBytes(userID string) (int64, error) {
	var total sql.NullInt64
	err := r.db.QueryRow(
		`SELECT SUM(byte_len) FROM drawings WHERE user_id = ?`, userID,
	).Scan(&total)
	if err != nil {
		return 0, err
	}
	return total.Int64, nil
}

// MarkOrphan marca um desenho como não usado (DELETE manual): o expurgo real
// só acontece depois da carência.
func (r *Repository) MarkOrphan(userID, id string, now int64) error {
	res, err := r.db.Exec(
		`UPDATE drawings SET orphaned_at = ? WHERE user_id = ? AND id = ? AND orphaned_at IS NULL`,
		now, userID, id,
	)
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		var c int
		if err := r.db.QueryRow(
			`SELECT COUNT(*) FROM drawings WHERE user_id = ? AND id = ?`, userID, id,
		).Scan(&c); err != nil {
			return err
		}
		if c == 0 {
			return fmt.Errorf("not found")
		}
	}
	return nil
}

// SyncRefs reescreve as referências de um zettel e reconcilia orphaned_at:
// desenho que ficou sem nenhuma referência ganha a marca, desenho que voltou a
// ser referenciado perde a marca. Tudo numa transação para não deixar estado
// intermediário visível a um expurgo concorrente.
func (r *Repository) SyncRefs(userID, zettelID string, drawingIDs []string, now int64) error {
	tx, err := r.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	// Ids que este zettel referenciava antes — precisam ser reavaliados mesmo
	// que sumam do body agora.
	touched := map[string]struct{}{}
	rows, err := tx.Query(
		`SELECT drawing_id FROM drawing_refs WHERE user_id = ? AND zettel_id = ?`, userID, zettelID,
	)
	if err != nil {
		return err
	}
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			rows.Close()
			return err
		}
		touched[id] = struct{}{}
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return err
	}

	if _, err := tx.Exec(
		`DELETE FROM drawing_refs WHERE user_id = ? AND zettel_id = ?`, userID, zettelID,
	); err != nil {
		return err
	}
	for _, id := range drawingIDs {
		touched[id] = struct{}{}
		if _, err := tx.Exec(
			`INSERT OR IGNORE INTO drawing_refs (user_id, drawing_id, zettel_id) VALUES (?, ?, ?)`,
			userID, id, zettelID,
		); err != nil {
			return err
		}
	}

	for id := range touched {
		var refs int
		if err := tx.QueryRow(
			`SELECT COUNT(*) FROM drawing_refs WHERE user_id = ? AND drawing_id = ?`, userID, id,
		).Scan(&refs); err != nil {
			return err
		}
		if refs == 0 {
			if _, err := tx.Exec(
				`UPDATE drawings SET orphaned_at = ? WHERE user_id = ? AND id = ? AND orphaned_at IS NULL`,
				now, userID, id,
			); err != nil {
				return err
			}
		} else {
			if _, err := tx.Exec(
				`UPDATE drawings SET orphaned_at = NULL WHERE user_id = ? AND id = ?`,
				userID, id,
			); err != nil {
				return err
			}
		}
	}

	return tx.Commit()
}

// PurgeOrphans apaga definitivamente os desenhos órfãos há mais que a carência.
// Não encolhe o arquivo .db — recuperar espaço em disco exige VACUUM manual.
func (r *Repository) PurgeOrphans(before int64) (int64, error) {
	res, err := r.db.Exec(
		`DELETE FROM drawings WHERE orphaned_at IS NOT NULL AND orphaned_at < ?`, before,
	)
	if err != nil {
		return 0, err
	}
	n, _ := res.RowsAffected()
	return n, nil
}
