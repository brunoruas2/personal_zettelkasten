package zettel

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"
	"time"

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

func (h *Handler) Routes() chi.Router {
	r := chi.NewRouter()
	r.Get("/", h.list)
	r.Post("/", h.create)
	r.Get("/{id}", h.getByID)
	r.Put("/{id}", h.update)
	r.Delete("/{id}", h.delete)
	r.Get("/{id}/backlinks", h.backlinks)
	r.Post("/rebuild-links", h.rebuildLinks)
	return r
}

// GET /api/zettels?since=&q=
func (h *Handler) list(w http.ResponseWriter, r *http.Request) {
	userID := auth.GetUserID(r)
	var since int64
	if s := r.URL.Query().Get("since"); s != "" {
		since, _ = strconv.ParseInt(s, 10, 64)
	}
	zettels, err := h.repo.List(userID, since, r.URL.Query().Get("q"))
	if err != nil {
		jsonError(w, http.StatusInternalServerError, err.Error())
		return
	}
	jsonOK(w, zettels)
}

// GET /api/zettels/:id
func (h *Handler) getByID(w http.ResponseWriter, r *http.Request) {
	userID := auth.GetUserID(r)
	z, err := h.repo.GetByID(userID, chi.URLParam(r, "id"))
	if err != nil {
		jsonError(w, http.StatusInternalServerError, err.Error())
		return
	}
	if z == nil {
		jsonError(w, http.StatusNotFound, "not found")
		return
	}
	jsonOK(w, z)
}

// POST /api/zettels
func (h *Handler) create(w http.ResponseWriter, r *http.Request) {
	userID := auth.GetUserID(r)
	var input struct {
		ID        string   `json:"id"`
		Title     string   `json:"title"`
		Body      string   `json:"body"`
		Tags      []string `json:"tags"`
		CreatedAt int64    `json:"created_at"`
		UpdatedAt int64    `json:"updated_at"`
	}
	if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
		jsonError(w, http.StatusBadRequest, "invalid json")
		return
	}
	if input.Title == "" {
		jsonError(w, http.StatusBadRequest, "title is required")
		return
	}
	now := time.Now().UnixMilli()
	if input.Tags == nil {
		input.Tags = []string{}
	}
	if input.CreatedAt == 0 {
		input.CreatedAt = now
	}
	if input.UpdatedAt == 0 {
		input.UpdatedAt = now
	}
	if input.ID == "" {
		input.ID = fmt.Sprintf("%d", now)
	}

	z := &models.Zettel{
		ID:        input.ID,
		UserID:    userID,
		Title:     input.Title,
		Body:      input.Body,
		Tags:      input.Tags,
		CreatedAt: input.CreatedAt,
		UpdatedAt: input.UpdatedAt,
	}
	if err := h.repo.Create(z); err != nil {
		jsonError(w, http.StatusInternalServerError, err.Error())
		return
	}
	h.syncLinks(userID, z.ID, z.Body)

	created, _ := h.repo.GetByID(userID, z.ID)
	w.WriteHeader(http.StatusCreated)
	jsonOK(w, created)
}

// PUT /api/zettels/:id
func (h *Handler) update(w http.ResponseWriter, r *http.Request) {
	userID := auth.GetUserID(r)
	id := chi.URLParam(r, "id")
	var input struct {
		Title     string   `json:"title"`
		Body      string   `json:"body"`
		Tags      []string `json:"tags"`
		UpdatedAt int64    `json:"updated_at"`
	}
	if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
		jsonError(w, http.StatusBadRequest, "invalid json")
		return
	}
	if input.Tags == nil {
		input.Tags = []string{}
	}
	if input.UpdatedAt == 0 {
		input.UpdatedAt = time.Now().UnixMilli()
	}

	z := &models.Zettel{
		ID:        id,
		UserID:    userID,
		Title:     input.Title,
		Body:      input.Body,
		Tags:      input.Tags,
		UpdatedAt: input.UpdatedAt,
	}
	if err := h.repo.Update(z); err != nil {
		if err.Error() == "not found" {
			jsonError(w, http.StatusNotFound, "not found")
			return
		}
		jsonError(w, http.StatusInternalServerError, err.Error())
		return
	}
	h.syncLinks(userID, id, z.Body)

	updated, _ := h.repo.GetByID(userID, id)
	jsonOK(w, updated)
}

// DELETE /api/zettels/:id
func (h *Handler) delete(w http.ResponseWriter, r *http.Request) {
	userID := auth.GetUserID(r)
	if err := h.repo.Delete(userID, chi.URLParam(r, "id"), time.Now().UnixMilli()); err != nil {
		if err.Error() == "not found" {
			jsonError(w, http.StatusNotFound, "not found")
			return
		}
		jsonError(w, http.StatusInternalServerError, err.Error())
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// GET /api/zettels/:id/backlinks
func (h *Handler) backlinks(w http.ResponseWriter, r *http.Request) {
	userID := auth.GetUserID(r)
	zettels, err := h.repo.GetBacklinks(userID, chi.URLParam(r, "id"))
	if err != nil {
		jsonError(w, http.StatusInternalServerError, err.Error())
		return
	}
	jsonOK(w, zettels)
}

// POST /api/zettels/rebuild-links
// Reprocessa todos os [[wiki links]] do usuário e reconstrói a tabela links do zero.
// Usado após migração inicial, quando zettels foram enviados um a um e a ordem de
// criação pode ter impedido alguns links de serem resolvidos.
func (h *Handler) rebuildLinks(w http.ResponseWriter, r *http.Request) {
	userID := auth.GetUserID(r)
	zettels, err := h.repo.List(userID, 0, "")
	if err != nil {
		jsonError(w, http.StatusInternalServerError, err.Error())
		return
	}
	for _, z := range zettels {
		h.syncLinks(userID, z.ID, z.Body)
	}
	w.WriteHeader(http.StatusNoContent)
}

// syncLinks resolve títulos de [[wiki links]] para IDs e atualiza a tabela links.
func (h *Handler) syncLinks(userID, sourceID, body string) {
	parsed := parseLinkTitles(body)
	var links []models.Link
	for _, p := range parsed {
		z, err := h.repo.FindByTitle(userID, p.title)
		if err != nil || z == nil {
			continue
		}
		l := models.Link{SourceID: sourceID, TargetID: z.ID}
		if p.isParentRef {
			l.Type = "parent-ref"
		}
		links = append(links, l)
	}
	_ = h.repo.UpsertLinks(sourceID, links)
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
