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

// ZettelMeta é o zettel sem corpo, para o pull do índice (fields=meta).
// BodyLen é o tamanho do corpo em bytes UTF-8.
type ZettelMeta struct {
	ID        string   `json:"id"`
	Title     string   `json:"title"`
	Tags      []string `json:"tags"`
	CreatedAt int64    `json:"created_at"`
	UpdatedAt int64    `json:"updated_at"`
	DeletedAt *int64   `json:"deleted_at,omitempty"`
	BodyLen   int64    `json:"body_len"`
}

// ZettelBody é o corpo de um zettel com a versão a que pertence.
type ZettelBody struct {
	ID        string `json:"id"`
	Body      string `json:"body"`
	UpdatedAt int64  `json:"updated_at"`
}

type Link struct {
	SourceID string `json:"source_id"`
	TargetID string `json:"target_id"`
	Type     string `json:"type,omitempty"`
}

type User struct {
	ID           string `json:"id"`
	Username     string `json:"username"`
	PasswordHash string `json:"-"`
	Role         string `json:"role"`
	CreatedAt    int64  `json:"created_at"`
}
