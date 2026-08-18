package auth

import (
	"sync"
	"time"

	"github.com/go-webauthn/webauthn/webauthn"
	"github.com/google/uuid"
)

// NewWebAuthn creates a configured WebAuthn instance.
func NewWebAuthn(rpID, rpDisplayName, rpOrigin string) (*webauthn.WebAuthn, error) {
	return webauthn.New(&webauthn.Config{
		RPID:          rpID,
		RPDisplayName: rpDisplayName,
		RPOrigins:     []string{rpOrigin},
	})
}

// SessionStore armazena WebAuthn SessionData em memória com TTL de 5 minutos.
type SessionStore struct {
	mu      sync.Mutex
	entries map[string]sessionEntry
}

type sessionEntry struct {
	data      webauthn.SessionData
	expiresAt time.Time
}

func NewSessionStore() *SessionStore {
	s := &SessionStore{entries: make(map[string]sessionEntry)}
	go s.cleanup()
	return s
}

func (s *SessionStore) Save(key string, data webauthn.SessionData) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.entries[key] = sessionEntry{data: data, expiresAt: time.Now().Add(5 * time.Minute)}
}

func (s *SessionStore) Get(key string) (webauthn.SessionData, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	e, ok := s.entries[key]
	if !ok || time.Now().After(e.expiresAt) {
		delete(s.entries, key)
		return webauthn.SessionData{}, false
	}
	delete(s.entries, key) // one-time use
	return e.data, true
}

func (s *SessionStore) NewKey() string {
	return uuid.NewString()
}

func (s *SessionStore) cleanup() {
	for range time.Tick(time.Minute) {
		s.mu.Lock()
		for k, e := range s.entries {
			if time.Now().After(e.expiresAt) {
				delete(s.entries, k)
			}
		}
		s.mu.Unlock()
	}
}

// WebAuthnUser adapta models.User + suas credenciais para a interface webauthn.User.
type WebAuthnUser struct {
	id          string
	username    string
	credentials []webauthn.Credential
}

func NewWebAuthnUser(id, username string, credentials []webauthn.Credential) *WebAuthnUser {
	return &WebAuthnUser{id: id, username: username, credentials: credentials}
}

func (u *WebAuthnUser) WebAuthnID() []byte          { return []byte(u.id) }
func (u *WebAuthnUser) WebAuthnName() string         { return u.username }
func (u *WebAuthnUser) WebAuthnDisplayName() string  { return u.username }
func (u *WebAuthnUser) WebAuthnCredentials() []webauthn.Credential { return u.credentials }
