package review

import (
	"database/sql"

	"github.com/brunofullstack/zettelkasten/api/internal/models"
)

type Repository struct {
	db *sql.DB
}

func NewRepository(db *sql.DB) *Repository {
	return &Repository{db: db}
}

// List devolve todos os estados de revisão do usuário. A tabela tem no máximo
// uma linha por zettel revisado, então não há paginação nem delta por `since`.
func (r *Repository) List(userID string) ([]models.Review, error) {
	rows, err := r.db.Query(`
		SELECT zettel_id, due_at, interval_days, ease, reps, lapses,
		       last_reviewed_at, suspended, updated_at
		FROM reviews WHERE user_id=?
	`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	reviews := []models.Review{}
	for rows.Next() {
		var (
			rev       models.Review
			suspended int
		)
		if err := rows.Scan(
			&rev.ZettelID, &rev.DueAt, &rev.IntervalDays, &rev.Ease, &rev.Reps,
			&rev.Lapses, &rev.LastReviewedAt, &suspended, &rev.UpdatedAt,
		); err != nil {
			return nil, err
		}
		rev.Suspended = suspended == 1
		reviews = append(reviews, rev)
	}
	return reviews, rows.Err()
}

// Upsert grava o estado. O last-write-wins mora no próprio SQL: uma escrita com
// updated_at menor ou igual ao que já está gravado não altera nada. É isso que
// torna o endpoint idempotente e permite reenviar a fila offline fora de ordem
// sem regredir o agendamento.
func (r *Repository) Upsert(userID string, rev models.Review) error {
	suspended := 0
	if rev.Suspended {
		suspended = 1
	}
	_, err := r.db.Exec(`
		INSERT INTO reviews (
			user_id, zettel_id, due_at, interval_days, ease, reps, lapses,
			last_reviewed_at, suspended, updated_at
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		ON CONFLICT(user_id, zettel_id) DO UPDATE SET
			due_at           = excluded.due_at,
			interval_days    = excluded.interval_days,
			ease             = excluded.ease,
			reps             = excluded.reps,
			lapses           = excluded.lapses,
			last_reviewed_at = excluded.last_reviewed_at,
			suspended        = excluded.suspended,
			updated_at       = excluded.updated_at
		WHERE excluded.updated_at > reviews.updated_at
	`, userID, rev.ZettelID, rev.DueAt, rev.IntervalDays, rev.Ease, rev.Reps,
		rev.Lapses, rev.LastReviewedAt, suspended, rev.UpdatedAt)
	return err
}

// Delete remove o estado — o zettel volta a ser tratado como nunca revisado.
func (r *Repository) Delete(userID, zettelID string) error {
	_, err := r.db.Exec(`DELETE FROM reviews WHERE user_id=? AND zettel_id=?`, userID, zettelID)
	return err
}
