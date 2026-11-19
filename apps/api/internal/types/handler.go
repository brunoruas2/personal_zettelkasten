package types

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"strconv"
	"time"

	"github.com/brunofullstack/zettelkasten/api/internal/auth"
	"github.com/go-chi/chi/v5"
)

const (
	maxBodyBytes int64 = 2 << 20
	maxBatch           = 5_000
)

// Notify recebe as mudanças já confirmadas (op "upsert" | "delete", ids = ids
// dos tipos ou dos zettels afetados). Nil = não publica.
type Notify func(ctx context.Context, userID, op string, ids []string)

// Handler expõe as rotas REST de tipos e atribuições. Todas exigem JWT: uma
// chave `zk_` recebe 401 (o agente só mexe em atribuição pelo MCP).
type Handler struct {
	repo   *Repository
	notify Notify
	now    func() time.Time
}

func NewHandler(repo *Repository) *Handler {
	return &Handler{repo: repo, now: time.Now}
}

// WithNotify liga a publicação no barramento de eventos.
func (h *Handler) WithNotify(n Notify) *Handler {
	h.notify = n
	return h
}

func (h *Handler) publish(ctx context.Context, userID, op string, ids []string) {
	if h.notify != nil && len(ids) > 0 {
		h.notify(ctx, userID, op, ids)
	}
}

// GET /api/types?since=<ms>
func (h *Handler) List(w http.ResponseWriter, r *http.Request) {
	since, ok := parseSince(w, r)
	if !ok {
		return
	}
	// Lido antes da consulta: uma escrita concorrente cai em synced_at >= este
	// valor e volta no próximo pull.
	serverTime := h.now().UnixMilli()
	out, err := h.repo.Since(auth.GetUserID(r), since)
	if err != nil {
		jsonError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"types": out, "server_time": serverTime})
}

// PUT /api/types — { types: [...] }, last-write-wins por updated_at do cliente.
func (h *Handler) Put(w http.ResponseWriter, r *http.Request) {
	var b struct {
		Types []Type `json:"types"`
	}
	if !decode(w, r, &b) {
		return
	}
	if len(b.Types) > maxBatch {
		jsonError(w, http.StatusRequestEntityTooLarge, "too many types")
		return
	}
	userID := auth.GetUserID(r)
	ignored, err := h.repo.Upsert(userID, b.Types, h.now().UnixMilli())
	if err != nil {
		writeRepoErr(w, err)
		return
	}
	ids := make([]string, 0, len(b.Types))
	skip := map[string]bool{}
	for _, id := range ignored {
		skip[id] = true
	}
	for _, t := range b.Types {
		if !skip[t.ID] {
			ids = append(ids, t.ID)
		}
	}
	h.publish(r.Context(), userID, "upsert", ids)
	writeJSON(w, http.StatusOK, map[string]any{"ignored": ignored})
}

// DELETE /api/types/{id} — apaga o tipo e solta os zettels dele (que ficam sem tipo).
func (h *Handler) Delete(w http.ResponseWriter, r *http.Request) {
	userID := auth.GetUserID(r)
	id := chi.URLParam(r, "id")
	affected, err := h.repo.Delete(userID, id, h.now().UnixMilli())
	if err != nil {
		writeRepoErr(w, err)
		return
	}
	h.publish(r.Context(), userID, "delete", append([]string{id}, affected...))
	writeJSON(w, http.StatusOK, map[string]any{"released": len(affected)})
}

// GET /api/type-assignments?since=<ms>
func (h *Handler) ListAssignments(w http.ResponseWriter, r *http.Request) {
	since, ok := parseSince(w, r)
	if !ok {
		return
	}
	serverTime := h.now().UnixMilli()
	out, err := h.repo.AssignmentsSince(auth.GetUserID(r), since)
	if err != nil {
		jsonError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"assignments": out, "server_time": serverTime})
}

// PUT /api/type-assignments — { assignments: [...] }. Itens com `deleted_at`
// viram "sem tipo". Devolve `skipped` (ids que ainda não são zettels do usuário).
func (h *Handler) PutAssignments(w http.ResponseWriter, r *http.Request) {
	var b struct {
		Assignments []Assignment `json:"assignments"`
	}
	if !decode(w, r, &b) {
		return
	}
	if len(b.Assignments) > maxBatch {
		jsonError(w, http.StatusRequestEntityTooLarge, "too many assignments")
		return
	}
	userID := auth.GetUserID(r)
	skipped, err := h.repo.UpsertAssignments(userID, b.Assignments, h.now().UnixMilli())
	if err != nil {
		writeRepoErr(w, err)
		return
	}
	skip := map[string]bool{}
	for _, id := range skipped {
		skip[id] = true
	}
	ids := make([]string, 0, len(b.Assignments))
	for _, a := range b.Assignments {
		if !skip[a.ZettelID] {
			ids = append(ids, a.ZettelID)
		}
	}
	h.publish(r.Context(), userID, "upsert", ids)
	writeJSON(w, http.StatusOK, map[string]any{"skipped": skipped})
}

func parseSince(w http.ResponseWriter, r *http.Request) (int64, bool) {
	s := r.URL.Query().Get("since")
	if s == "" {
		return 0, true
	}
	v, err := strconv.ParseInt(s, 10, 64)
	if err != nil || v < 0 {
		jsonError(w, http.StatusBadRequest, "invalid since")
		return 0, false
	}
	return v, true
}

func decode(w http.ResponseWriter, r *http.Request, dst any) bool {
	r.Body = http.MaxBytesReader(w, r.Body, maxBodyBytes)
	if err := json.NewDecoder(r.Body).Decode(dst); err != nil {
		var tooLarge *http.MaxBytesError
		if errors.As(err, &tooLarge) {
			jsonError(w, http.StatusRequestEntityTooLarge, "body too large")
			return false
		}
		jsonError(w, http.StatusBadRequest, "invalid json")
		return false
	}
	return true
}

func writeRepoErr(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, ErrNotFound):
		jsonError(w, http.StatusNotFound, "not found")
	case errors.Is(err, ErrSlugTaken):
		jsonError(w, http.StatusConflict, err.Error())
	case errors.Is(err, ErrLimit):
		jsonError(w, http.StatusBadRequest, err.Error())
	case errors.Is(err, ErrInvalid):
		msg := err.Error()
		if len(msg) > len("invalid: ") {
			msg = msg[len("invalid: "):]
		}
		jsonError(w, http.StatusBadRequest, msg)
	default:
		jsonError(w, http.StatusInternalServerError, err.Error())
	}
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(v) //nolint:errcheck
}

func jsonError(w http.ResponseWriter, status int, msg string) {
	writeJSON(w, status, map[string]string{"error": msg})
}
