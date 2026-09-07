package review

import (
	"encoding/json"
	"net/http"

	"github.com/brunofullstack/zettelkasten/api/internal/auth"
	"github.com/brunofullstack/zettelkasten/api/internal/models"
	"github.com/go-chi/chi/v5"
)

type Handler struct {
	repo *Repository
}

func NewHandler(repo *Repository) *Handler {
	return &Handler{repo: repo}
}

// GET /api/reviews
func (h *Handler) List(w http.ResponseWriter, r *http.Request) {
	reviews, err := h.repo.List(auth.GetUserID(r))
	if err != nil {
		jsonError(w, http.StatusInternalServerError, err.Error())
		return
	}
	jsonOK(w, reviews)
}

// PUT /api/reviews/{zettelId}
func (h *Handler) Upsert(w http.ResponseWriter, r *http.Request) {
	var in struct {
		DueAt          int64   `json:"due_at"`
		IntervalDays   int     `json:"interval_days"`
		Ease           float64 `json:"ease"`
		Reps           int     `json:"reps"`
		Lapses         int     `json:"lapses"`
		LastReviewedAt int64   `json:"last_reviewed_at"`
		Suspended      bool    `json:"suspended"`
		UpdatedAt      int64   `json:"updated_at"`
	}
	if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
		jsonError(w, http.StatusBadRequest, "invalid json")
		return
	}

	// O id vem da rota, nunca do corpo: é o que impede um cliente de gravar no
	// lugar de outro zettel enviando um id divergente.
	rev := models.Review{
		ZettelID:       chi.URLParam(r, "zettelId"),
		DueAt:          in.DueAt,
		IntervalDays:   in.IntervalDays,
		Ease:           in.Ease,
		Reps:           in.Reps,
		Lapses:         in.Lapses,
		LastReviewedAt: in.LastReviewedAt,
		Suspended:      in.Suspended,
		UpdatedAt:      in.UpdatedAt,
	}
	if rev.ZettelID == "" {
		jsonError(w, http.StatusBadRequest, "missing zettel id")
		return
	}

	if err := h.repo.Upsert(auth.GetUserID(r), rev); err != nil {
		jsonError(w, http.StatusInternalServerError, err.Error())
		return
	}
	jsonOK(w, rev)
}

// DELETE /api/reviews/{zettelId}
func (h *Handler) Delete(w http.ResponseWriter, r *http.Request) {
	if err := h.repo.Delete(auth.GetUserID(r), chi.URLParam(r, "zettelId")); err != nil {
		jsonError(w, http.StatusInternalServerError, err.Error())
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// --- helpers ---

func jsonOK(w http.ResponseWriter, v any) {
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(v)
}

func jsonError(w http.ResponseWriter, status int, msg string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(map[string]string{"error": msg})
}
