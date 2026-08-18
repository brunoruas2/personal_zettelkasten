package auth

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"time"

	"github.com/brunofullstack/zettelkasten/api/internal/models"
	"github.com/go-webauthn/webauthn/webauthn"
	"github.com/google/uuid"
	"golang.org/x/crypto/bcrypt"
)

type Repository struct {
	db *sql.DB
}

func NewRepository(db *sql.DB) *Repository {
	return &Repository{db: db}
}

func (r *Repository) CreateUser(username, password, role string) (*models.User, error) {
	hash, err := bcrypt.GenerateFromPassword([]byte(password), 12)
	if err != nil {
		return nil, err
	}
	u := &models.User{
		ID:           uuid.NewString(),
		Username:     username,
		PasswordHash: string(hash),
		Role:         role,
		CreatedAt:    time.Now().UnixMilli(),
	}
	_, err = r.db.Exec(`
		INSERT INTO users (id, username, password_hash, role, created_at)
		VALUES (?, ?, ?, ?, ?)
	`, u.ID, u.Username, u.PasswordHash, u.Role, u.CreatedAt)
	if err != nil {
		return nil, err
	}
	return u, nil
}

func (r *Repository) GetUserByUsername(username string) (*models.User, error) {
	row := r.db.QueryRow(`
		SELECT id, username, password_hash, role, created_at
		FROM users WHERE username = ?
	`, username)
	return scanUser(row)
}

func (r *Repository) GetUserByID(id string) (*models.User, error) {
	row := r.db.QueryRow(`
		SELECT id, username, password_hash, role, created_at
		FROM users WHERE id = ?
	`, id)
	return scanUser(row)
}

func (r *Repository) ListUsers() ([]models.User, error) {
	rows, err := r.db.Query(`SELECT id, username, password_hash, role, created_at FROM users ORDER BY created_at`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var users []models.User
	for rows.Next() {
		u, err := scanUserRow(rows)
		if err != nil {
			return nil, err
		}
		users = append(users, *u)
	}
	if users == nil {
		users = []models.User{}
	}
	return users, rows.Err()
}

func (r *Repository) DeleteUser(id string) error {
	_, err := r.db.Exec(`DELETE FROM users WHERE id = ?`, id)
	return err
}

func (r *Repository) UpdatePassword(userID, newPassword string) error {
	hash, err := bcrypt.GenerateFromPassword([]byte(newPassword), 12)
	if err != nil {
		return err
	}
	_, err = r.db.Exec(`UPDATE users SET password_hash = ? WHERE id = ?`, string(hash), userID)
	return err
}

// --- Invites ---

func (r *Repository) CreateInvite(createdBy string, ttlDays int) (string, error) {
	token := uuid.NewString()
	expiresAt := time.Now().AddDate(0, 0, ttlDays).UnixMilli()
	_, err := r.db.Exec(`
		INSERT INTO invites (token, created_by, expires_at) VALUES (?, ?, ?)
	`, token, createdBy, expiresAt)
	return token, err
}

type Invite struct {
	Token     string  `json:"token"`
	CreatedBy string  `json:"created_by"`
	UsedBy    *string `json:"used_by,omitempty"`
	ExpiresAt int64   `json:"expires_at"`
}

func (r *Repository) ListInvites() ([]Invite, error) {
	rows, err := r.db.Query(`
		SELECT token, created_by, used_by, expires_at FROM invites
		WHERE used_by IS NULL AND expires_at > ? ORDER BY expires_at
	`, time.Now().UnixMilli())
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var invites []Invite
	for rows.Next() {
		var inv Invite
		var usedBy sql.NullString
		if err := rows.Scan(&inv.Token, &inv.CreatedBy, &usedBy, &inv.ExpiresAt); err != nil {
			return nil, err
		}
		if usedBy.Valid {
			inv.UsedBy = &usedBy.String
		}
		invites = append(invites, inv)
	}
	if invites == nil {
		invites = []Invite{}
	}
	return invites, rows.Err()
}

func (r *Repository) GetInvite(token string) (*Invite, error) {
	row := r.db.QueryRow(`
		SELECT token, created_by, used_by, expires_at FROM invites WHERE token = ?
	`, token)
	var inv Invite
	var usedBy sql.NullString
	if err := row.Scan(&inv.Token, &inv.CreatedBy, &usedBy, &inv.ExpiresAt); err != nil {
		if err == sql.ErrNoRows {
			return nil, nil
		}
		return nil, err
	}
	if usedBy.Valid {
		inv.UsedBy = &usedBy.String
	}
	return &inv, nil
}

func (r *Repository) UseInvite(token, userID string) error {
	res, err := r.db.Exec(`
		UPDATE invites SET used_by = ?
		WHERE token = ? AND used_by IS NULL AND expires_at > ?
	`, userID, token, time.Now().UnixMilli())
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return fmt.Errorf("invite invalid or expired")
	}
	return nil
}

func (r *Repository) RevokeInvite(token string) error {
	_, err := r.db.Exec(`DELETE FROM invites WHERE token = ?`, token)
	return err
}

// --- Refresh tokens ---

func (r *Repository) CreateRefreshToken(userID string, ttlDays int) (string, error) {
	token := uuid.NewString()
	expiresAt := time.Now().AddDate(0, 0, ttlDays).UnixMilli()
	_, err := r.db.Exec(`
		INSERT INTO refresh_tokens (token, user_id, expires_at) VALUES (?, ?, ?)
	`, token, userID, expiresAt)
	return token, err
}

func (r *Repository) ValidateRefreshToken(token string) (string, error) {
	var userID string
	var expiresAt int64
	err := r.db.QueryRow(`
		SELECT user_id, expires_at FROM refresh_tokens WHERE token = ?
	`, token).Scan(&userID, &expiresAt)
	if err == sql.ErrNoRows {
		return "", fmt.Errorf("invalid token")
	}
	if err != nil {
		return "", err
	}
	if time.Now().UnixMilli() > expiresAt {
		return "", fmt.Errorf("token expired")
	}
	return userID, nil
}

func (r *Repository) RevokeRefreshToken(token string) error {
	_, err := r.db.Exec(`DELETE FROM refresh_tokens WHERE token = ?`, token)
	return err
}

func (r *Repository) RevokeAllRefreshTokens(userID string) error {
	_, err := r.db.Exec(`DELETE FROM refresh_tokens WHERE user_id = ?`, userID)
	return err
}

// --- WebAuthn credentials ---

type CredentialRecord struct {
	ID     string `json:"id"`
	Name   string `json:"name"`
	UserID string `json:"user_id"`
}

func (r *Repository) CreateCredential(userID, name string, cred webauthn.Credential) (string, error) {
	id := uuid.NewString()
	data, err := json.Marshal(cred)
	if err != nil {
		return "", err
	}
	_, err = r.db.Exec(`
		INSERT INTO webauthn_credentials (id, user_id, name, credential) VALUES (?, ?, ?, ?)
	`, id, userID, name, string(data))
	return id, err
}

func (r *Repository) ListCredentialRecords(userID string) ([]CredentialRecord, error) {
	rows, err := r.db.Query(`
		SELECT id, name, user_id FROM webauthn_credentials WHERE user_id = ?
	`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var records []CredentialRecord
	for rows.Next() {
		var rec CredentialRecord
		if err := rows.Scan(&rec.ID, &rec.Name, &rec.UserID); err != nil {
			return nil, err
		}
		records = append(records, rec)
	}
	if records == nil {
		records = []CredentialRecord{}
	}
	return records, rows.Err()
}

// GetWebAuthnCredentials retorna as credenciais deserializadas de um usuário (para a interface webauthn.User).
func (r *Repository) GetWebAuthnCredentials(userID string) ([]webauthn.Credential, error) {
	rows, err := r.db.Query(`
		SELECT credential FROM webauthn_credentials WHERE user_id = ?
	`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var creds []webauthn.Credential
	for rows.Next() {
		var raw string
		if err := rows.Scan(&raw); err != nil {
			return nil, err
		}
		var cred webauthn.Credential
		if err := json.Unmarshal([]byte(raw), &cred); err != nil {
			continue // credencial corrompida — ignorar
		}
		creds = append(creds, cred)
	}
	return creds, rows.Err()
}

// GetUserByCredentialRawID encontra o usuário dono de uma credencial pelo seu RawID (para discoverable login).
func (r *Repository) GetUserByCredentialRawID(rawID []byte) (*models.User, []webauthn.Credential, error) {
	rows, err := r.db.Query(`
		SELECT wc.user_id, wc.credential FROM webauthn_credentials wc
	`)
	if err != nil {
		return nil, nil, err
	}
	defer rows.Close()

	var matchedUserID string
	for rows.Next() {
		var uid, raw string
		if err := rows.Scan(&uid, &raw); err != nil {
			continue
		}
		var cred webauthn.Credential
		if err := json.Unmarshal([]byte(raw), &cred); err != nil {
			continue
		}
		if string(cred.ID) == string(rawID) {
			matchedUserID = uid
			break
		}
	}
	if matchedUserID == "" {
		return nil, nil, fmt.Errorf("credential not found")
	}

	user, err := r.GetUserByID(matchedUserID)
	if err != nil || user == nil {
		return nil, nil, fmt.Errorf("user not found")
	}
	creds, err := r.GetWebAuthnCredentials(matchedUserID)
	return user, creds, err
}

func (r *Repository) DeleteCredential(userID, credID string) error {
	_, err := r.db.Exec(`
		DELETE FROM webauthn_credentials WHERE id = ? AND user_id = ?
	`, credID, userID)
	return err
}

// UpdateCredential persiste contador de uso atualizado após login bem-sucedido.
func (r *Repository) UpdateCredential(userID string, cred webauthn.Credential) error {
	data, err := json.Marshal(cred)
	if err != nil {
		return err
	}
	// Encontra pelo ID da credencial WebAuthn (não o UUID do banco)
	rows, err := r.db.Query(`SELECT id, credential FROM webauthn_credentials WHERE user_id = ?`, userID)
	if err != nil {
		return err
	}
	defer rows.Close()
	for rows.Next() {
		var dbID, raw string
		if err := rows.Scan(&dbID, &raw); err != nil {
			continue
		}
		var existing webauthn.Credential
		if err := json.Unmarshal([]byte(raw), &existing); err != nil {
			continue
		}
		if string(existing.ID) == string(cred.ID) {
			_, err = r.db.Exec(`UPDATE webauthn_credentials SET credential = ? WHERE id = ?`, string(data), dbID)
			return err
		}
	}
	return nil
}

// --- Backup keys ---

// SetBackupKey stores the SHA-256 hash of the user's backup key (one per user, upsert).
func (r *Repository) SetBackupKey(userID, keyHash string) error {
	// Remove old key for this user first (only one allowed)
	_, _ = r.db.Exec(`DELETE FROM backup_keys WHERE user_id = ?`, userID)
	_, err := r.db.Exec(`
		INSERT INTO backup_keys (key_hash, user_id, created_at) VALUES (?, ?, ?)
	`, keyHash, userID, time.Now().UnixMilli())
	return err
}

// DeleteBackupKey revokes the backup key for a user.
func (r *Repository) DeleteBackupKey(userID string) error {
	_, err := r.db.Exec(`DELETE FROM backup_keys WHERE user_id = ?`, userID)
	return err
}

// HasBackupKey returns true if the user has an active backup key.
func (r *Repository) HasBackupKey(userID string) (bool, error) {
	var count int
	err := r.db.QueryRow(`SELECT COUNT(*) FROM backup_keys WHERE user_id = ?`, userID).Scan(&count)
	return count > 0, err
}

// FindUserByBackupKeyHash returns the user associated with the given key hash.
func (r *Repository) FindUserByBackupKeyHash(keyHash string) (*models.User, error) {
	row := r.db.QueryRow(`
		SELECT u.id, u.username, u.password_hash, u.role, u.created_at
		FROM backup_keys bk
		JOIN users u ON u.id = bk.user_id
		WHERE bk.key_hash = ?
	`, keyHash)
	return scanUser(row)
}

// --- User settings ---

// NodeColorRule maps a zettel to a cluster color; neighbors inherit the same color.
type NodeColorRule struct {
	ZettelID    string `json:"zettelId"`
	ZettelTitle string `json:"zettelTitle"`
	Color       string `json:"color"`
}

// UserSettings holds per-user preferences stored as JSON in users.settings.
type UserSettings struct {
	ZettelTemplate    string          `json:"zettel_template"`
	GraphExcludedTags []string        `json:"graph_excluded_tags,omitempty"`
	GraphNodeColors   []NodeColorRule `json:"graph_node_colors,omitempty"`
}

func (r *Repository) GetUserSettings(userID string) (*UserSettings, error) {
	var raw string
	err := r.db.QueryRow(`SELECT settings FROM users WHERE id = ?`, userID).Scan(&raw)
	if err != nil {
		return nil, err
	}
	var s UserSettings
	if err := json.Unmarshal([]byte(raw), &s); err != nil {
		// corrupt or empty — return defaults
		return &UserSettings{}, nil
	}
	return &s, nil
}

func (r *Repository) UpdateUserSettings(userID string, s UserSettings) error {
	data, err := json.Marshal(s)
	if err != nil {
		return err
	}
	_, err = r.db.Exec(`UPDATE users SET settings = ? WHERE id = ?`, string(data), userID)
	return err
}

// --- helpers ---

func scanUser(row *sql.Row) (*models.User, error) {
	var u models.User
	err := row.Scan(&u.ID, &u.Username, &u.PasswordHash, &u.Role, &u.CreatedAt)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	return &u, err
}

func scanUserRow(rows *sql.Rows) (*models.User, error) {
	var u models.User
	err := rows.Scan(&u.ID, &u.Username, &u.PasswordHash, &u.Role, &u.CreatedAt)
	return &u, err
}
