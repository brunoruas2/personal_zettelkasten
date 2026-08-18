package auth

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"regexp"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/go-webauthn/webauthn/webauthn"
	"github.com/golang-jwt/jwt/v5"
	"golang.org/x/crypto/bcrypt"
)

var hexRe = regexp.MustCompile(`^[0-9a-f]{64}$`)

const (
	accessTokenTTL  = 15 * time.Minute
	refreshTokenTTL = 30 // days
	refreshCookie   = "refresh_token"
)

type Handler struct {
	repo      *Repository
	jwtSecret string
	wa        *webauthn.WebAuthn
	sessions  *SessionStore
}

func NewHandler(repo *Repository, jwtSecret string, wa *webauthn.WebAuthn, sessions *SessionStore) *Handler {
	return &Handler{repo: repo, jwtSecret: jwtSecret, wa: wa, sessions: sessions}
}

// Routes returns a single router for all /api/auth routes.
// Protected routes have RequireAuth applied internally to avoid double-mounting
// the same prefix in main.go (chi doesn't support overlapping Mounts).
func (h *Handler) Routes(jwtSecret string) chi.Router {
	r := chi.NewRouter()

	// Public
	r.Post("/login", h.login)
	r.Post("/refresh", h.refresh)
	r.Post("/logout", h.logout)
	r.Post("/register", h.register)
	r.Post("/passkey/login/begin", h.passkeyLoginBegin)
	r.Post("/passkey/login/finish", h.passkeyLoginFinish)

	// Protected (require valid JWT)
	r.Group(func(r chi.Router) {
		r.Use(RequireAuth(jwtSecret))
		r.Get("/me", h.me)
		r.Get("/settings", h.getSettings)
		r.Put("/settings", h.updateSettings)
		r.Post("/passkey/register/begin", h.passkeyRegisterBegin)
		r.Post("/passkey/register/finish", h.passkeyRegisterFinish)
		r.Get("/passkeys", h.listPasskeys)
		r.Delete("/passkey/{id}", h.deletePasskey)
		r.Put("/password", h.changePassword)
		r.Post("/backup-key", h.setBackupKey)
		r.Get("/backup-key", h.getBackupKeyStatus)
		r.Delete("/backup-key", h.deleteBackupKey)
	})

	return r
}

func (h *Handler) AdminRoutes() chi.Router {
	r := chi.NewRouter()
	r.Use(RequireAdmin)
	r.Post("/invites", h.createInvite)
	r.Get("/invites", h.listInvites)
	r.Delete("/invites/{token}", h.revokeInvite)
	r.Get("/users", h.listUsers)
	r.Delete("/users/{id}", h.deleteUser)
	return r
}

// POST /api/auth/login
func (h *Handler) login(w http.ResponseWriter, r *http.Request) {
	var input struct {
		Username string `json:"username"`
		Password string `json:"password"`
	}
	if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
		jsonErr(w, http.StatusBadRequest, "invalid json")
		return
	}

	user, err := h.repo.GetUserByUsername(input.Username)
	if err != nil || user == nil {
		jsonErr(w, http.StatusUnauthorized, "invalid credentials")
		return
	}
	if err := bcrypt.CompareHashAndPassword([]byte(user.PasswordHash), []byte(input.Password)); err != nil {
		jsonErr(w, http.StatusUnauthorized, "invalid credentials")
		return
	}

	accessToken, err := h.generateAccessToken(user.ID, user.Role)
	if err != nil {
		jsonErr(w, http.StatusInternalServerError, "token error")
		return
	}

	refreshToken, err := h.repo.CreateRefreshToken(user.ID, refreshTokenTTL)
	if err != nil {
		jsonErr(w, http.StatusInternalServerError, "token error")
		return
	}

	setRefreshCookie(w, refreshToken, refreshTokenTTL)
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]any{
		"access_token": accessToken,
		"expires_in":   int(accessTokenTTL.Seconds()),
	})
}

// POST /api/auth/refresh
func (h *Handler) refresh(w http.ResponseWriter, r *http.Request) {
	cookie, err := r.Cookie(refreshCookie)
	if err != nil {
		jsonErr(w, http.StatusUnauthorized, "missing refresh token")
		return
	}

	userID, err := h.repo.ValidateRefreshToken(cookie.Value)
	if err != nil {
		jsonErr(w, http.StatusUnauthorized, err.Error())
		return
	}

	user, err := h.repo.GetUserByID(userID)
	if err != nil || user == nil {
		jsonErr(w, http.StatusUnauthorized, "user not found")
		return
	}

	accessToken, err := h.generateAccessToken(user.ID, user.Role)
	if err != nil {
		jsonErr(w, http.StatusInternalServerError, "token error")
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]any{
		"access_token": accessToken,
		"expires_in":   int(accessTokenTTL.Seconds()),
	})
}

// POST /api/auth/logout
func (h *Handler) logout(w http.ResponseWriter, r *http.Request) {
	cookie, err := r.Cookie(refreshCookie)
	if err == nil {
		_ = h.repo.RevokeRefreshToken(cookie.Value)
	}
	setRefreshCookie(w, "", -1) // apaga o cookie
	w.WriteHeader(http.StatusNoContent)
}

// GET /api/auth/me
func (h *Handler) me(w http.ResponseWriter, r *http.Request) {
	user, err := h.repo.GetUserByID(GetUserID(r))
	if err != nil || user == nil {
		jsonErr(w, http.StatusNotFound, "user not found")
		return
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{
		"id":       user.ID,
		"username": user.Username,
		"role":     user.Role,
	})
}

// POST /api/auth/register  body: { invite_token, username, password }
func (h *Handler) register(w http.ResponseWriter, r *http.Request) {
	var input struct {
		InviteToken string `json:"invite_token"`
		Username    string `json:"username"`
		Password    string `json:"password"`
	}
	if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
		jsonErr(w, http.StatusBadRequest, "invalid json")
		return
	}
	if input.Username == "" || input.Password == "" || input.InviteToken == "" {
		jsonErr(w, http.StatusBadRequest, "invite_token, username and password are required")
		return
	}

	invite, err := h.repo.GetInvite(input.InviteToken)
	if err != nil {
		jsonErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	if invite == nil || invite.UsedBy != nil {
		jsonErr(w, http.StatusBadRequest, "invite invalid or already used")
		return
	}
	if time.Now().UnixMilli() > invite.ExpiresAt {
		jsonErr(w, http.StatusBadRequest, "invite expired")
		return
	}

	user, err := h.repo.CreateUser(input.Username, input.Password, "member")
	if err != nil {
		jsonErr(w, http.StatusConflict, "username already taken")
		return
	}

	if err := h.repo.UseInvite(input.InviteToken, user.ID); err != nil {
		jsonErr(w, http.StatusInternalServerError, err.Error())
		return
	}

	w.WriteHeader(http.StatusCreated)
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{
		"id":       user.ID,
		"username": user.Username,
	})
}

// POST /api/admin/invites
func (h *Handler) createInvite(w http.ResponseWriter, r *http.Request) {
	token, err := h.repo.CreateInvite(GetUserID(r), 7)
	if err != nil {
		jsonErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	json.NewEncoder(w).Encode(map[string]string{"token": token})
}

// GET /api/admin/invites
func (h *Handler) listInvites(w http.ResponseWriter, r *http.Request) {
	invites, err := h.repo.ListInvites()
	if err != nil {
		jsonErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(invites)
}

// DELETE /api/admin/invites/:token
func (h *Handler) revokeInvite(w http.ResponseWriter, r *http.Request) {
	if err := h.repo.RevokeInvite(chi.URLParam(r, "token")); err != nil {
		jsonErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// GET /api/admin/users
func (h *Handler) listUsers(w http.ResponseWriter, r *http.Request) {
	users, err := h.repo.ListUsers()
	if err != nil {
		jsonErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(users)
}

// DELETE /api/admin/users/:id
func (h *Handler) deleteUser(w http.ResponseWriter, r *http.Request) {
	if err := h.repo.DeleteUser(chi.URLParam(r, "id")); err != nil {
		jsonErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// GET /api/auth/settings
func (h *Handler) getSettings(w http.ResponseWriter, r *http.Request) {
	s, err := h.repo.GetUserSettings(GetUserID(r))
	if err != nil {
		jsonErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(s)
}

// PUT /api/auth/settings — accepts a partial object; only provided keys are updated.
func (h *Handler) updateSettings(w http.ResponseWriter, r *http.Request) {
	current, err := h.repo.GetUserSettings(GetUserID(r))
	if err != nil {
		jsonErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	var patch map[string]json.RawMessage
	if err := json.NewDecoder(r.Body).Decode(&patch); err != nil {
		jsonErr(w, http.StatusBadRequest, "invalid json")
		return
	}
	if v, ok := patch["zettel_template"]; ok {
		json.Unmarshal(v, &current.ZettelTemplate) //nolint:errcheck
	}
	if v, ok := patch["graph_excluded_tags"]; ok {
		json.Unmarshal(v, &current.GraphExcludedTags) //nolint:errcheck
	}
	if v, ok := patch["graph_node_colors"]; ok {
		json.Unmarshal(v, &current.GraphNodeColors) //nolint:errcheck
	}
	if err := h.repo.UpdateUserSettings(GetUserID(r), *current); err != nil {
		jsonErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(current)
}

// --- Passkey handlers ---

const passkeySessionCookie = "passkey_session"

// POST /api/auth/passkey/register/begin  (autenticado)
func (h *Handler) passkeyRegisterBegin(w http.ResponseWriter, r *http.Request) {
	userID := GetUserID(r)
	user, err := h.repo.GetUserByID(userID)
	if err != nil || user == nil {
		jsonErr(w, http.StatusUnauthorized, "user not found")
		return
	}
	creds, err := h.repo.GetWebAuthnCredentials(userID)
	if err != nil {
		jsonErr(w, http.StatusInternalServerError, err.Error())
		return
	}

	waUser := NewWebAuthnUser(user.ID, user.Username, creds)
	options, session, err := h.wa.BeginRegistration(waUser)
	if err != nil {
		jsonErr(w, http.StatusInternalServerError, err.Error())
		return
	}

	key := h.sessions.NewKey()
	h.sessions.Save("reg:"+key, *session)
	http.SetCookie(w, &http.Cookie{
		Name:     passkeySessionCookie,
		Value:    key,
		Path:     "/api/auth",
		HttpOnly: true,
		SameSite: http.SameSiteStrictMode,
		MaxAge:   300,
	})

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(options)
}

// POST /api/auth/passkey/register/finish  (autenticado)
func (h *Handler) passkeyRegisterFinish(w http.ResponseWriter, r *http.Request) {
	userID := GetUserID(r)
	user, err := h.repo.GetUserByID(userID)
	if err != nil || user == nil {
		jsonErr(w, http.StatusUnauthorized, "user not found")
		return
	}

	cookie, err := r.Cookie(passkeySessionCookie)
	if err != nil {
		jsonErr(w, http.StatusBadRequest, "missing session cookie")
		return
	}
	session, ok := h.sessions.Get("reg:" + cookie.Value)
	if !ok {
		jsonErr(w, http.StatusBadRequest, "session expired or invalid")
		return
	}

	creds, err := h.repo.GetWebAuthnCredentials(userID)
	if err != nil {
		jsonErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	waUser := NewWebAuthnUser(user.ID, user.Username, creds)

	credential, err := h.wa.FinishRegistration(waUser, session, r)
	if err != nil {
		jsonErr(w, http.StatusBadRequest, err.Error())
		return
	}

	// Nome do dispositivo — opcional no body
	var input struct {
		Name string `json:"name"`
	}
	_ = json.NewDecoder(r.Body).Decode(&input)
	if input.Name == "" {
		input.Name = "Passkey"
	}

	id, err := h.repo.CreateCredential(userID, input.Name, *credential)
	if err != nil {
		jsonErr(w, http.StatusInternalServerError, err.Error())
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	json.NewEncoder(w).Encode(map[string]string{"id": id, "name": input.Name})
}

// POST /api/auth/passkey/login/begin  (público — discoverable, sem username)
func (h *Handler) passkeyLoginBegin(w http.ResponseWriter, r *http.Request) {
	options, session, err := h.wa.BeginDiscoverableLogin()
	if err != nil {
		jsonErr(w, http.StatusInternalServerError, err.Error())
		return
	}

	key := h.sessions.NewKey()
	h.sessions.Save("login:"+key, *session)
	http.SetCookie(w, &http.Cookie{
		Name:     passkeySessionCookie,
		Value:    key,
		Path:     "/api/auth",
		HttpOnly: true,
		SameSite: http.SameSiteStrictMode,
		MaxAge:   300,
	})

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(options)
}

// POST /api/auth/passkey/login/finish  (público)
func (h *Handler) passkeyLoginFinish(w http.ResponseWriter, r *http.Request) {
	cookie, err := r.Cookie(passkeySessionCookie)
	if err != nil {
		jsonErr(w, http.StatusBadRequest, "missing session cookie")
		return
	}
	session, ok := h.sessions.Get("login:" + cookie.Value)
	if !ok {
		jsonErr(w, http.StatusBadRequest, "session expired or invalid")
		return
	}

	credential, err := h.wa.FinishDiscoverableLogin(
		func(rawID, userHandle []byte) (webauthn.User, error) {
			user, creds, err := h.repo.GetUserByCredentialRawID(rawID)
			if err != nil {
				return nil, err
			}
			return NewWebAuthnUser(user.ID, user.Username, creds), nil
		},
		session, r,
	)
	if err != nil {
		jsonErr(w, http.StatusUnauthorized, err.Error())
		return
	}

	// Atualiza contador de uso da credencial
	userHandle := session.UserID
	user, _, _ := h.repo.GetUserByCredentialRawID(credential.ID)
	if user != nil {
		_ = h.repo.UpdateCredential(user.ID, *credential)
		_ = userHandle
	}

	accessToken, err := h.generateAccessToken(user.ID, user.Role)
	if err != nil {
		jsonErr(w, http.StatusInternalServerError, "token error")
		return
	}
	refreshToken, err := h.repo.CreateRefreshToken(user.ID, refreshTokenTTL)
	if err != nil {
		jsonErr(w, http.StatusInternalServerError, "token error")
		return
	}

	setRefreshCookie(w, refreshToken, refreshTokenTTL)
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]any{
		"access_token": accessToken,
		"expires_in":   int(accessTokenTTL.Seconds()),
	})
}

// GET /api/auth/passkeys  (autenticado)
func (h *Handler) listPasskeys(w http.ResponseWriter, r *http.Request) {
	records, err := h.repo.ListCredentialRecords(GetUserID(r))
	if err != nil {
		jsonErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(records)
}

// DELETE /api/auth/passkey/:id  (autenticado)
func (h *Handler) deletePasskey(w http.ResponseWriter, r *http.Request) {
	if err := h.repo.DeleteCredential(GetUserID(r), chi.URLParam(r, "id")); err != nil {
		jsonErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// PUT /api/auth/password  body: { current_password, new_password }
func (h *Handler) changePassword(w http.ResponseWriter, r *http.Request) {
	var input struct {
		CurrentPassword string `json:"current_password"`
		NewPassword     string `json:"new_password"`
	}
	if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
		jsonErr(w, http.StatusBadRequest, "invalid json")
		return
	}
	if input.CurrentPassword == "" || input.NewPassword == "" {
		jsonErr(w, http.StatusBadRequest, "current_password and new_password are required")
		return
	}
	if len(input.NewPassword) < 8 {
		jsonErr(w, http.StatusBadRequest, "new_password must be at least 8 characters")
		return
	}

	user, err := h.repo.GetUserByID(GetUserID(r))
	if err != nil || user == nil {
		jsonErr(w, http.StatusNotFound, "user not found")
		return
	}
	if err := bcrypt.CompareHashAndPassword([]byte(user.PasswordHash), []byte(input.CurrentPassword)); err != nil {
		jsonErr(w, http.StatusUnauthorized, "senha atual incorreta")
		return
	}
	if err := h.repo.UpdatePassword(user.ID, input.NewPassword); err != nil {
		jsonErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// --- Backup key handlers ---

// POST /api/auth/backup-key
// Body: { "key": "<64 hex chars>" }
// The frontend generates the key; we store only its SHA-256 hash.
func (h *Handler) setBackupKey(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Key string `json:"key"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		jsonErr(w, http.StatusBadRequest, "invalid json")
		return
	}
	if !hexRe.MatchString(body.Key) {
		jsonErr(w, http.StatusBadRequest, "key must be 64 lowercase hex characters")
		return
	}
	sum := sha256.Sum256([]byte(body.Key))
	keyHash := hex.EncodeToString(sum[:])
	if err := h.repo.SetBackupKey(GetUserID(r), keyHash); err != nil {
		jsonErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]bool{"ok": true})
}

// GET /api/auth/backup-key
func (h *Handler) getBackupKeyStatus(w http.ResponseWriter, r *http.Request) {
	has, err := h.repo.HasBackupKey(GetUserID(r))
	if err != nil {
		jsonErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]bool{"active": has})
}

// DELETE /api/auth/backup-key
func (h *Handler) deleteBackupKey(w http.ResponseWriter, r *http.Request) {
	if err := h.repo.DeleteBackupKey(GetUserID(r)); err != nil {
		jsonErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// --- helpers ---

func (h *Handler) generateAccessToken(userID, role string) (string, error) {
	claims := jwt.MapClaims{
		"sub":  userID,
		"role": role,
		"exp":  time.Now().Add(accessTokenTTL).Unix(),
	}
	return jwt.NewWithClaims(jwt.SigningMethodHS256, claims).SignedString([]byte(h.jwtSecret))
}

func setRefreshCookie(w http.ResponseWriter, token string, days int) {
	maxAge := days * 86400
	http.SetCookie(w, &http.Cookie{
		Name:     refreshCookie,
		Value:    token,
		Path:     "/", // must be "/" so the browser sends it on page navigations (middleware check)
		HttpOnly: true,
		SameSite: http.SameSiteStrictMode,
		MaxAge:   maxAge,
	})
}
