package zettel

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"regexp"
	"strconv"

	"github.com/brunofullstack/zettelkasten/api/internal/auth"
	"github.com/brunofullstack/zettelkasten/api/internal/drawings"
	"github.com/brunofullstack/zettelkasten/api/internal/images"
	"github.com/go-chi/chi/v5"
)

// Handler é a casca HTTP de /api/zettels: decodifica, chama o Service e
// traduz os erros tipados. As regras moram no Service.
type Handler struct {
	svc *Service
}

// NewHandler monta um Service próprio (compatível com quem só tem os repos).
func NewHandler(repo *Repository, imageRepo *images.Repository) *Handler {
	return &Handler{svc: NewService(repo, imageRepo)}
}

// NewHandlerWithService usa um Service já montado (main.go, para compartilhar com o MCP).
func NewHandlerWithService(svc *Service) *Handler {
	return &Handler{svc: svc}
}

// WithDrawings liga a contagem de referências de desenho (`zk:draw/<id>`) aos
// mesmos pontos em que as de imagem rodam.
func (h *Handler) WithDrawings(repo *drawings.Repository) *Handler {
	h.svc.WithDrawings(repo)
	return h
}

// Service expõe o serviço do handler.
func (h *Handler) Service() *Service { return h.svc }

func (h *Handler) Routes() chi.Router {
	r := chi.NewRouter()
	r.Get("/", h.list)
	r.Post("/", h.create)
	r.Post("/bodies", h.bodies)
	r.Get("/{id}", h.getByID)
	r.Put("/{id}", h.update)
	r.Delete("/{id}", h.delete)
	r.Get("/{id}/backlinks", h.backlinks)
	r.Post("/rebuild-links", h.rebuildLinks)
	return r
}

// GET /api/zettels?since=&q=&fields=meta
// Com fields=meta (e sem q) devolve o índice sem corpo — o pull do cliente; os
// corpos vêm depois por POST /api/zettels/bodies. Sem fields, o comportamento
// antigo (com corpo) continua para a chave de API e clientes antigos em cache.
func (h *Handler) list(w http.ResponseWriter, r *http.Request) {
	userID := auth.GetUserID(r)
	var since int64
	if s := r.URL.Query().Get("since"); s != "" {
		since, _ = strconv.ParseInt(s, 10, 64)
	}
	q := r.URL.Query().Get("q")
	if r.URL.Query().Get("fields") == "meta" && q == "" {
		metas, err := h.svc.ListMeta(userID, since)
		if err != nil {
			writeErr(w, err)
			return
		}
		jsonOK(w, metas)
		return
	}
	// type= (id ou slug) e level= (chave) restringem pelas atribuições de tipo.
	zettels, err := h.svc.ListBy(userID, since, q, TypeRef{
		Type:  r.URL.Query().Get("type"),
		Level: r.URL.Query().Get("level"),
	})
	if err != nil {
		writeErr(w, err)
		return
	}
	jsonOK(w, zettels)
}

// maxBodiesPerRequest limita o lote de POST /api/zettels/bodies.
const maxBodiesPerRequest = 200

var bodyIDRE = regexp.MustCompile(`^[A-Za-z0-9]{1,64}$`)

// POST /api/zettels/bodies — { ids } → [{ id, body, updated_at }].
// Fora da allowlist da chave de API (POST em /api/zettels/{x}): só JWT.
func (h *Handler) bodies(w http.ResponseWriter, r *http.Request) {
	var req struct {
		IDs []string `json:"ids"`
	}
	r.Body = http.MaxBytesReader(w, r.Body, 64<<10)
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		jsonError(w, http.StatusBadRequest, "invalid json")
		return
	}
	if len(req.IDs) > maxBodiesPerRequest {
		jsonError(w, http.StatusBadRequest, fmt.Sprintf("at most %d ids per request", maxBodiesPerRequest))
		return
	}
	for _, id := range req.IDs {
		if !bodyIDRE.MatchString(id) {
			jsonError(w, http.StatusBadRequest, "invalid zettel id")
			return
		}
	}
	out, err := h.svc.Bodies(auth.GetUserID(r), req.IDs)
	if err != nil {
		writeErr(w, err)
		return
	}
	jsonOK(w, out)
}

// GET /api/zettels/:id
func (h *Handler) getByID(w http.ResponseWriter, r *http.Request) {
	z, err := h.svc.Get(auth.GetUserID(r), chi.URLParam(r, "id"))
	if err != nil {
		writeErr(w, err)
		return
	}
	jsonOK(w, z)
}

// POST /api/zettels
func (h *Handler) create(w http.ResponseWriter, r *http.Request) {
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
	created, err := h.svc.Create(r.Context(), auth.GetUserID(r), CreateInput{
		ID: input.ID, Title: input.Title, Body: input.Body, Tags: input.Tags,
		CreatedAt: input.CreatedAt, UpdatedAt: input.UpdatedAt,
	})
	if err != nil {
		writeErr(w, err)
		return
	}
	w.WriteHeader(http.StatusCreated)
	jsonOK(w, created)
}

// PUT /api/zettels/:id
func (h *Handler) update(w http.ResponseWriter, r *http.Request) {
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
	updated, err := h.svc.Update(r.Context(), auth.GetUserID(r), chi.URLParam(r, "id"), UpdateInput{
		Title: input.Title, Body: input.Body, Tags: input.Tags, UpdatedAt: input.UpdatedAt,
	})
	if err != nil {
		writeErr(w, err)
		return
	}
	jsonOK(w, updated)
}

// DELETE /api/zettels/:id
func (h *Handler) delete(w http.ResponseWriter, r *http.Request) {
	if err := h.svc.Delete(r.Context(), auth.GetUserID(r), chi.URLParam(r, "id")); err != nil {
		writeErr(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// GET /api/zettels/:id/backlinks
func (h *Handler) backlinks(w http.ResponseWriter, r *http.Request) {
	zettels, err := h.svc.Backlinks(auth.GetUserID(r), chi.URLParam(r, "id"))
	if err != nil {
		writeErr(w, err)
		return
	}
	jsonOK(w, zettels)
}

// POST /api/zettels/rebuild-links
// Reprocessa todos os [[wiki links]] do usuário e reconstrói a tabela links do zero.
// Usado após migração inicial, quando zettels foram enviados um a um e a ordem de
// criação pode ter impedido alguns links de serem resolvidos.
func (h *Handler) rebuildLinks(w http.ResponseWriter, r *http.Request) {
	if err := h.svc.RebuildLinks(auth.GetUserID(r)); err != nil {
		writeErr(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// imageRefRE casa as referências de imagem no corpo: ![alt](zk:img/<32 hex>).
var imageRefRE = regexp.MustCompile(`zk:img/([0-9a-f]{32})`)

// ParseImageIDs extrai os ids de imagem referenciados por um corpo, sem repetir.
func ParseImageIDs(body string) []string {
	return uniqueSubmatches(imageRefRE, body)
}

var drawingRefRE = regexp.MustCompile(`zk:draw/([A-Za-z0-9]{1,64})`)

// ParseDrawingIDs extrai os ids de desenho referenciados por um corpo, sem repetir.
func ParseDrawingIDs(body string) []string {
	return uniqueSubmatches(drawingRefRE, body)
}

func uniqueSubmatches(re *regexp.Regexp, body string) []string {
	matches := re.FindAllStringSubmatch(body, -1)
	seen := make(map[string]struct{}, len(matches))
	ids := make([]string, 0, len(matches))
	for _, m := range matches {
		if _, dup := seen[m[1]]; dup {
			continue
		}
		seen[m[1]] = struct{}{}
		ids = append(ids, m[1])
	}
	return ids
}

// --- helpers ---

// writeErr traduz os erros tipados do Service: 404, 409, 400; o resto é 500.
func writeErr(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, ErrNotFound):
		jsonError(w, http.StatusNotFound, "not found")
	case errors.Is(err, ErrPatchMismatch):
		jsonError(w, http.StatusConflict, err.Error())
	case errors.Is(err, ErrForbidden):
		msg := err.Error()
		if len(msg) > len("forbidden: ") {
			msg = msg[len("forbidden: "):]
		}
		jsonError(w, http.StatusForbidden, msg)
	case errors.Is(err, ErrConflict):
		msg := err.Error()
		if len(msg) > len("conflict: ") {
			msg = msg[len("conflict: "):]
		}
		jsonError(w, http.StatusConflict, msg)
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

func jsonOK(w http.ResponseWriter, v any) {
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(v)
}

func jsonError(w http.ResponseWriter, status int, msg string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(map[string]string{"error": msg})
}
