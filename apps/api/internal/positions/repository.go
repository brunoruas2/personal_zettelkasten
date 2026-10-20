package positions

import (
	"database/sql"
	"errors"
)

// Entry é a posição de um zettel na galáxia: centro do card, coordenadas de
// mundo inteiras. UpdatedAt vem do cliente e decide o last-write-wins.
type Entry struct {
	ID        string `json:"id"`
	X         int64  `json:"x"`
	Y         int64  `json:"y"`
	UpdatedAt int64  `json:"updated_at"`
}

// Mode decide o que acontece quando o zettel já tem posição.
type Mode string

const (
	// ModeLWW substitui só se updated_at for estritamente maior (movimento manual).
	ModeLWW Mode = "lww"
	// ModeIfAbsent nunca substitui (posicionamento automático): o primeiro
	// dispositivo a gravar vence e os outros adotam a posição do servidor.
	ModeIfAbsent Mode = "if_absent"
)

// ErrAlreadyInitialized: o init só vale para quem ainda não tem nenhuma posição.
var ErrAlreadyInitialized = errors.New("positions already initialized")

type Repository struct {
	db *sql.DB
}

func NewRepository(db *sql.DB) *Repository {
	return &Repository{db: db}
}

// Since devolve as posições gravadas no servidor em synced_at >= since. O `>=`
// repete as linhas do último milissegundo, o que é inofensivo (o merge do
// cliente é idempotente) e evita perder uma escrita no mesmo ms do cursor.
func (r *Repository) Since(userID string, since int64) ([]Entry, error) {
	rows, err := r.db.Query(`
		SELECT zettel_id, x, y, updated_at FROM positions
		WHERE user_id = ? AND synced_at >= ?
		ORDER BY zettel_id
	`, userID, since)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Entry{}
	for rows.Next() {
		var e Entry
		if err := rows.Scan(&e.ID, &e.X, &e.Y, &e.UpdatedAt); err != nil {
			return nil, err
		}
		out = append(out, e)
	}
	return out, rows.Err()
}

// Upsert grava o lote numa transação. Devolve, para cada item não gravado de
// um zettel existente, a posição que permaneceu no servidor (kept), e os ids
// que não são zettels vivos do usuário (skipped). O cliente mantém os skipped
// pendentes: a posição de um zettel recém-criado pode chegar antes do próprio
// zettel, que sobe por outra fila.
func (r *Repository) Upsert(userID string, entries []Entry, mode Mode, now int64) (kept []Entry, skipped []string, err error) {
	tx, err := r.db.Begin()
	if err != nil {
		return nil, nil, err
	}
	defer tx.Rollback() //nolint:errcheck

	conflict := `ON CONFLICT (user_id, zettel_id) DO NOTHING`
	if mode == ModeLWW {
		conflict = `ON CONFLICT (user_id, zettel_id) DO UPDATE SET
			x = excluded.x, y = excluded.y,
			updated_at = excluded.updated_at, synced_at = excluded.synced_at
		WHERE excluded.updated_at > positions.updated_at`
	}
	ins, err := tx.Prepare(`
		INSERT INTO positions (user_id, zettel_id, x, y, updated_at, synced_at)
		VALUES (?, ?, ?, ?, ?, ?) ` + conflict)
	if err != nil {
		return nil, nil, err
	}
	defer ins.Close()

	kept = []Entry{}
	skipped = []string{}
	for _, e := range entries {
		ok, err := zettelExists(tx, userID, e.ID)
		if err != nil {
			return nil, nil, err
		}
		if !ok {
			skipped = append(skipped, e.ID)
			continue
		}
		res, err := ins.Exec(userID, e.ID, e.X, e.Y, e.UpdatedAt, now)
		if err != nil {
			return nil, nil, err
		}
		if n, _ := res.RowsAffected(); n > 0 {
			continue
		}
		var cur Entry
		cur.ID = e.ID
		if err := tx.QueryRow(
			`SELECT x, y, updated_at FROM positions WHERE user_id = ? AND zettel_id = ?`, userID, e.ID,
		).Scan(&cur.X, &cur.Y, &cur.UpdatedAt); err != nil {
			return nil, nil, err
		}
		kept = append(kept, cur)
	}
	return kept, skipped, tx.Commit()
}

// Init grava o layout congelado inteiro, tudo ou nada: se o usuário já tem
// qualquer posição, nada é gravado e volta ErrAlreadyInitialized. Misturar por
// zettel dois layouts calculados por dispositivos diferentes daria um mapa
// sem sentido.
func (r *Repository) Init(userID string, entries []Entry, now int64) error {
	tx, err := r.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback() //nolint:errcheck

	var n int
	if err := tx.QueryRow(`SELECT COUNT(*) FROM positions WHERE user_id = ?`, userID).Scan(&n); err != nil {
		return err
	}
	if n > 0 {
		return ErrAlreadyInitialized
	}
	ins, err := tx.Prepare(`
		INSERT OR IGNORE INTO positions (user_id, zettel_id, x, y, updated_at, synced_at)
		VALUES (?, ?, ?, ?, ?, ?)`)
	if err != nil {
		return err
	}
	defer ins.Close()
	for _, e := range entries {
		ok, err := zettelExists(tx, userID, e.ID)
		if err != nil {
			return err
		}
		if !ok {
			continue
		}
		if _, err := ins.Exec(userID, e.ID, e.X, e.Y, e.UpdatedAt, now); err != nil {
			return err
		}
	}
	return tx.Commit()
}

// Reset apaga todas as posições do usuário e avança galaxy_layout_epoch em
// users.settings, na mesma transação. Os outros dispositivos veem a época nova
// e descartam as posições locais. Devolve a época nova.
func (r *Repository) Reset(userID string) (int, error) {
	tx, err := r.db.Begin()
	if err != nil {
		return 0, err
	}
	defer tx.Rollback() //nolint:errcheck

	if _, err := tx.Exec(`DELETE FROM positions WHERE user_id = ?`, userID); err != nil {
		return 0, err
	}
	if _, err := tx.Exec(`
		UPDATE users SET settings = json_set(
			CASE WHEN json_valid(settings) THEN settings ELSE '{}' END,
			'$.galaxy_layout_epoch',
			COALESCE(CASE WHEN json_valid(settings) THEN json_extract(settings, '$.galaxy_layout_epoch') END, 0) + 1)
		WHERE id = ?`, userID); err != nil {
		return 0, err
	}
	epoch, err := epochOf(tx, userID)
	if err != nil {
		return 0, err
	}
	return epoch, tx.Commit()
}

// Epoch devolve a época de layout atual (0 se nunca houve reset).
func (r *Repository) Epoch(userID string) (int, error) {
	return epochOf(r.db, userID)
}

type queryer interface {
	QueryRow(query string, args ...any) *sql.Row
}

func epochOf(q queryer, userID string) (int, error) {
	var epoch int
	err := q.QueryRow(`
		SELECT COALESCE(CASE WHEN json_valid(settings) THEN json_extract(settings, '$.galaxy_layout_epoch') END, 0)
		FROM users WHERE id = ?`, userID).Scan(&epoch)
	return epoch, err
}

func zettelExists(q queryer, userID, id string) (bool, error) {
	var one int
	err := q.QueryRow(
		`SELECT 1 FROM zettels WHERE id = ? AND user_id = ? AND deleted_at IS NULL`, id, userID,
	).Scan(&one)
	if err == sql.ErrNoRows {
		return false, nil
	}
	return err == nil, err
}
