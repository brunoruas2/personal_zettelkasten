package images

import (
	"database/sql"
	"fmt"
)

// OrphanGraceMillis é a carência entre uma imagem perder a última referência e
// ser apagada de fato. Um device offline pode ter um zettel novo que referencia
// a imagem e ainda não ter sincronizado — para o servidor ela já tem 0 refs.
const OrphanGraceMillis int64 = 30 * 24 * 60 * 60 * 1000

// Meta são os metadados de uma imagem, sem os bytes.
type Meta struct {
	ID        string `json:"id"`
	Mime      string `json:"mime"`
	Width     int    `json:"width"`
	Height    int    `json:"height"`
	ByteLen   int64  `json:"byte_len"`
	CreatedAt int64  `json:"created_at"`
}

type Repository struct {
	db *sql.DB
}

func NewRepository(db *sql.DB) *Repository {
	return &Repository{db: db}
}

// Insert grava os bytes. É idempotente: reenviar o mesmo id não reescreve o
// blob, apenas limpa orphaned_at (o reenvio ressuscita uma imagem órfã).
func (r *Repository) Insert(userID string, m Meta, data []byte) error {
	_, err := r.db.Exec(`
		INSERT INTO images (id, user_id, mime, width, height, byte_len, data, created_at, orphaned_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL)
		ON CONFLICT (user_id, id) DO UPDATE SET orphaned_at = NULL
	`, m.ID, userID, m.Mime, m.Width, m.Height, m.ByteLen, data, m.CreatedAt)
	return err
}

// Exists diz se o par (user, id) já está gravado.
func (r *Repository) Exists(userID, id string) (bool, error) {
	var n int
	err := r.db.QueryRow(
		`SELECT COUNT(*) FROM images WHERE user_id = ? AND id = ?`, userID, id,
	).Scan(&n)
	return n > 0, err
}

// Get devolve metadados + bytes. É um dos dois únicos lugares que leem a coluna
// data (o outro é o export ZIP em portability).
func (r *Repository) Get(userID, id string) (*Meta, []byte, error) {
	var (
		m    Meta
		data []byte
	)
	err := r.db.QueryRow(`
		SELECT id, mime, width, height, byte_len, created_at, data
		FROM images WHERE user_id = ? AND id = ?
	`, userID, id).Scan(&m.ID, &m.Mime, &m.Width, &m.Height, &m.ByteLen, &m.CreatedAt, &data)
	if err == sql.ErrNoRows {
		return nil, nil, nil
	}
	if err != nil {
		return nil, nil, err
	}
	return &m, data, nil
}

// Manifest lista os metadados de todas as imagens do usuário, sem os bytes.
func (r *Repository) Manifest(userID string) ([]Meta, error) {
	rows, err := r.db.Query(`
		SELECT id, mime, width, height, byte_len, created_at
		FROM images WHERE user_id = ? ORDER BY created_at DESC
	`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	metas := []Meta{}
	for rows.Next() {
		var m Meta
		if err := rows.Scan(&m.ID, &m.Mime, &m.Width, &m.Height, &m.ByteLen, &m.CreatedAt); err != nil {
			return nil, err
		}
		metas = append(metas, m)
	}
	return metas, rows.Err()
}

// UsedBytes soma o espaço ocupado pelas imagens do usuário.
func (r *Repository) UsedBytes(userID string) (int64, error) {
	var total sql.NullInt64
	err := r.db.QueryRow(
		`SELECT SUM(byte_len) FROM images WHERE user_id = ?`, userID,
	).Scan(&total)
	if err != nil {
		return 0, err
	}
	return total.Int64, nil
}

// MarkOrphan marca uma imagem específica como não usada (usado pelo DELETE manual).
func (r *Repository) MarkOrphan(userID, id string, now int64) error {
	res, err := r.db.Exec(
		`UPDATE images SET orphaned_at = ? WHERE user_id = ? AND id = ? AND orphaned_at IS NULL`,
		now, userID, id,
	)
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		exists, err := r.Exists(userID, id)
		if err != nil {
			return err
		}
		if !exists {
			return fmt.Errorf("not found")
		}
	}
	return nil
}

// SyncRefs reescreve as referências de um zettel e reconcilia orphaned_at:
// imagem que ficou sem nenhuma referência ganha a marca, imagem que voltou a ser
// referenciada perde a marca. Tudo numa transação para não deixar estado
// intermediário visível a um expurgo concorrente.
func (r *Repository) SyncRefs(userID, zettelID string, imageIDs []string, now int64) error {
	tx, err := r.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	// Ids que este zettel referenciava antes — precisam ser reavaliados mesmo
	// que sumam do body agora.
	touched := map[string]struct{}{}
	rows, err := tx.Query(`SELECT image_id FROM image_refs WHERE zettel_id = ?`, zettelID)
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

	if _, err := tx.Exec(`DELETE FROM image_refs WHERE zettel_id = ?`, zettelID); err != nil {
		return err
	}
	for _, id := range imageIDs {
		touched[id] = struct{}{}
		if _, err := tx.Exec(
			`INSERT OR IGNORE INTO image_refs (image_id, zettel_id) VALUES (?, ?)`,
			id, zettelID,
		); err != nil {
			return err
		}
	}

	for id := range touched {
		var refs int
		if err := tx.QueryRow(
			`SELECT COUNT(*) FROM image_refs WHERE image_id = ?`, id,
		).Scan(&refs); err != nil {
			return err
		}
		if refs == 0 {
			if _, err := tx.Exec(
				`UPDATE images SET orphaned_at = ? WHERE user_id = ? AND id = ? AND orphaned_at IS NULL`,
				now, userID, id,
			); err != nil {
				return err
			}
		} else {
			if _, err := tx.Exec(
				`UPDATE images SET orphaned_at = NULL WHERE user_id = ? AND id = ?`,
				userID, id,
			); err != nil {
				return err
			}
		}
	}

	return tx.Commit()
}

// PurgeOrphans apaga definitivamente as imagens órfãs há mais que a carência.
// Não encolhe o arquivo .db — recuperar espaço em disco exige VACUUM manual.
func (r *Repository) PurgeOrphans(before int64) (int64, error) {
	res, err := r.db.Exec(
		`DELETE FROM images WHERE orphaned_at IS NOT NULL AND orphaned_at < ?`, before,
	)
	if err != nil {
		return 0, err
	}
	n, _ := res.RowsAffected()
	return n, nil
}
