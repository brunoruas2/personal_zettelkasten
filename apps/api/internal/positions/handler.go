package positions

import (
	"encoding/json"
	"errors"
	"math"
	"net/http"
	"regexp"
	"strconv"
	"time"

	"github.com/brunofullstack/zettelkasten/api/internal/auth"
)

// O init leva a base inteira de uma vez (~60 bytes por item): 200k itens
// cabem com folga em 16 MB.
const (
	maxBodyBytes int64 = 16 << 20
	maxItems           = 200_000
	maxCoord           = 1e9
)

var idRE = regexp.MustCompile(`^[A-Za-z0-9]{1,64}$`)

type Handler struct {
	repo *Repository
}

func NewHandler(repo *Repository) *Handler {
	return &Handler{repo: repo}
}

// wireEntry aceita coordenadas fracionárias; a gravação arredonda.
type wireEntry struct {
	ID        string  `json:"id"`
	X         float64 `json:"x"`
	Y         float64 `json:"y"`
	UpdatedAt int64   `json:"updated_at"`
}

type putBody struct {
	Mode      Mode        `json:"mode"`
	Positions []wireEntry `json:"positions"`
}

type initBody struct {
	Positions []wireEntry `json:"positions"`
}

// GET /api/positions?since=<ms>
func (h *Handler) List(w http.ResponseWriter, r *http.Request) {
	userID := auth.GetUserID(r)
	var since int64
	if s := r.URL.Query().Get("since"); s != "" {
		v, err := strconv.ParseInt(s, 10, 64)
		if err != nil || v < 0 {
			jsonError(w, http.StatusBadRequest, "invalid since")
			return
		}
		since = v
	}
	// Lido antes da consulta: uma escrita concorrente cai em synced_at >= este
	// valor e volta no próximo pull.
	serverTime := time.Now().UnixMilli()
	entries, err := h.repo.Since(userID, since)
	if err != nil {
		jsonError(w, http.StatusInternalServerError, err.Error())
		return
	}
	epoch, err := h.repo.Epoch(userID)
	if err != nil {
		jsonError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"positions":   entries,
		"epoch":       epoch,
		"server_time": serverTime,
	})
}

// PUT /api/positions — lote com mode "lww" ou "if_absent".
func (h *Handler) Put(w http.ResponseWriter, r *http.Request) {
	var b putBody
	if !decode(w, r, &b) {
		return
	}
	if b.Mode != ModeLWW && b.Mode != ModeIfAbsent {
		jsonError(w, http.StatusBadRequest, `mode must be "lww" or "if_absent"`)
		return
	}
	entries, ok := validate(w, b.Positions)
	if !ok {
		return
	}
	kept, skipped, err := h.repo.Upsert(auth.GetUserID(r), entries, b.Mode, time.Now().UnixMilli())
	if err != nil {
		jsonError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"kept": kept, "skipped": skipped})
}

// POST /api/positions/init — layout congelado, tudo ou nada.
func (h *Handler) Init(w http.ResponseWriter, r *http.Request) {
	var b initBody
	if !decode(w, r, &b) {
		return
	}
	entries, ok := validate(w, b.Positions)
	if !ok {
		return
	}
	err := h.repo.Init(auth.GetUserID(r), entries, time.Now().UnixMilli())
	if errors.Is(err, ErrAlreadyInitialized) {
		jsonError(w, http.StatusConflict, err.Error())
		return
	}
	if err != nil {
		jsonError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"status": "ok"})
}

// DELETE /api/positions — descarta todas as posições e avança a época.
func (h *Handler) Reset(w http.ResponseWriter, r *http.Request) {
	epoch, err := h.repo.Reset(auth.GetUserID(r))
	if err != nil {
		jsonError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"epoch": epoch})
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

func validate(w http.ResponseWriter, in []wireEntry) ([]Entry, bool) {
	if len(in) > maxItems {
		jsonError(w, http.StatusRequestEntityTooLarge, "too many positions")
		return nil, false
	}
	out := make([]Entry, 0, len(in))
	for _, e := range in {
		if !idRE.MatchString(e.ID) {
			jsonError(w, http.StatusBadRequest, "invalid zettel id")
			return nil, false
		}
		if !finite(e.X) || !finite(e.Y) {
			jsonError(w, http.StatusBadRequest, "invalid coordinates")
			return nil, false
		}
		if e.UpdatedAt <= 0 {
			jsonError(w, http.StatusBadRequest, "updated_at is required")
			return nil, false
		}
		out = append(out, Entry{
			ID:        e.ID,
			X:         int64(math.Round(e.X)),
			Y:         int64(math.Round(e.Y)),
			UpdatedAt: e.UpdatedAt,
		})
	}
	return out, true
}

func finite(v float64) bool {
	return !math.IsNaN(v) && !math.IsInf(v, 0) && math.Abs(v) <= maxCoord
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(v) //nolint:errcheck
}

func jsonError(w http.ResponseWriter, status int, msg string) {
	writeJSON(w, status, map[string]string{"error": msg})
}
