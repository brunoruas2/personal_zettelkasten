package models

type Zettel struct {
	ID        string   `json:"id"`
	UserID    string   `json:"user_id,omitempty"`
	Title     string   `json:"title"`
	Body      string   `json:"body"`
	Tags      []string `json:"tags"`
	CreatedAt int64    `json:"created_at"`
	UpdatedAt int64    `json:"updated_at"`
	DeletedAt *int64   `json:"deleted_at,omitempty"`
}

type Link struct {
	SourceID string `json:"source_id"`
	TargetID string `json:"target_id"`
	Type     string `json:"type,omitempty"`
}

// Review é o estado de revisão espaçada de um zettel. Timestamps em
// milissegundos desde a época, como o resto da API.
type Review struct {
	ZettelID       string  `json:"zettel_id"`
	UserID         string  `json:"user_id,omitempty"`
	DueAt          int64   `json:"due_at"`
	IntervalDays   int     `json:"interval_days"`
	Ease           float64 `json:"ease"`
	Reps           int     `json:"reps"`
	Lapses         int     `json:"lapses"`
	LastReviewedAt int64   `json:"last_reviewed_at"`
	Suspended      bool    `json:"suspended"`
	UpdatedAt      int64   `json:"updated_at"`
}

type User struct {
	ID           string `json:"id"`
	Username     string `json:"username"`
	PasswordHash string `json:"-"`
	Role         string `json:"role"`
	CreatedAt    int64  `json:"created_at"`
}
