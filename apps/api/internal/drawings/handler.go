package drawings

import (
	"bytes"
	"context"
	"encoding/json"
	"encoding/xml"
	"errors"
	"io"
	"net/http"
	"regexp"
	"strings"
	"time"

	"github.com/brunofullstack/zettelkasten/api/internal/auth"
	"github.com/go-chi/chi/v5"
)

// MaxDrawingBytes é o teto por desenho: cena + SVG. O corpo da requisição tem
// folga extra (escape JSON da cena embutida como string) — o teto que vale é o
// da soma dos dois campos.
const MaxDrawingBytes int64 = 5 << 20

const maxBodyBytes int64 = 2*MaxDrawingBytes + 64<<10

// maxDimension limita width/height aceitos do cliente (px do SVG exportado).
const maxDimension = 1_000_000

var idRE = regexp.MustCompile(`^[A-Za-z0-9]{1,64}$`)

type Handler struct {
	repo       *Repository
	quotaBytes int64
	notify     NotifyFunc
}

// NotifyFunc é avisada depois de cada escrita efetiva ("upsert" ou "delete").
type NotifyFunc func(ctx context.Context, userID, op, id string)

// WithNotify liga as escritas de desenho ao barramento de tempo real.
func (h *Handler) WithNotify(fn NotifyFunc) *Handler {
	h.notify = fn
	return h
}

func NewHandler(repo *Repository, quotaBytes int64) *Handler {
	return &Handler{repo: repo, quotaBytes: quotaBytes}
}

type putBody struct {
	Scene     string `json:"scene"`
	SVG       string `json:"svg"`
	Width     int    `json:"width"`
	Height    int    `json:"height"`
	CreatedAt int64  `json:"created_at"`
	UpdatedAt int64  `json:"updated_at"`
}

// PUT /api/drawings/{id}
// Upsert com last-write-wins por updated_at. Validação, nesta ordem: tamanho,
// cena JSON (zk-sketch, ou excalidraw legada), SVG inofensivo, quota.
func (h *Handler) Put(w http.ResponseWriter, r *http.Request) {
	userID := auth.GetUserID(r)
	id := chi.URLParam(r, "id")
	if !idRE.MatchString(id) {
		jsonError(w, http.StatusBadRequest, "invalid drawing id")
		return
	}

	r.Body = http.MaxBytesReader(w, r.Body, maxBodyBytes)
	raw, err := io.ReadAll(r.Body)
	if err != nil {
		var tooLarge *http.MaxBytesError
		if errors.As(err, &tooLarge) {
			jsonError(w, http.StatusRequestEntityTooLarge, "drawing exceeds 5 MB")
			return
		}
		jsonError(w, http.StatusBadRequest, "could not read body")
		return
	}
	var b putBody
	if err := json.Unmarshal(raw, &b); err != nil {
		jsonError(w, http.StatusBadRequest, "invalid json")
		return
	}
	status, err := h.Store(r.Context(), userID, id, StoreInput(b))
	if err != nil {
		var se *StoreError
		if errors.As(err, &se) {
			jsonError(w, se.Status, se.Msg)
			return
		}
		jsonError(w, http.StatusInternalServerError, err.Error())
		return
	}
	jsonOK(w, map[string]string{"id": id, "status": status})
}

// StoreInput é o desenho a gravar (mesmos campos do corpo do PUT).
type StoreInput putBody

// StoreError é uma recusa de validação, tamanho ou quota, com o status HTTP.
type StoreError struct {
	Status int
	Msg    string
}

func (e *StoreError) Error() string { return e.Msg }

// ValidID diz se o id de desenho é aceito (alfanumérico, até 64).
func ValidID(id string) bool { return idRE.MatchString(id) }

// Store valida e grava um desenho (o PUT e o MCP usam o mesmo caminho).
// Validação, nesta ordem: tamanho, cena JSON (zk-sketch, ou excalidraw
// legada), SVG inofensivo, updated_at, quota. Devolve "stored" ou "ignored"
// (last-write-wins: o armazenado é igual ou mais novo).
func (h *Handler) Store(ctx context.Context, userID, id string, b StoreInput) (string, error) {
	if !idRE.MatchString(id) {
		return "", &StoreError{http.StatusBadRequest, "invalid drawing id"}
	}
	byteLen := int64(len(b.Scene) + len(b.SVG))
	if byteLen > MaxDrawingBytes {
		return "", &StoreError{http.StatusRequestEntityTooLarge, "drawing exceeds 5 MB"}
	}
	if err := ValidateScene(b.Scene); err != nil {
		return "", &StoreError{http.StatusBadRequest, err.Error()}
	}
	if err := ValidateSVG(b.SVG); err != nil {
		return "", &StoreError{http.StatusBadRequest, err.Error()}
	}
	if b.UpdatedAt <= 0 {
		return "", &StoreError{http.StatusBadRequest, "updated_at is required"}
	}
	if b.CreatedAt <= 0 {
		b.CreatedAt = b.UpdatedAt
	}
	if b.Width < 0 || b.Width > maxDimension {
		b.Width = 0
	}
	if b.Height < 0 || b.Height > maxDimension {
		b.Height = 0
	}

	// Regravar o mesmo id substitui o conteúdo, não soma à quota.
	used, err := h.repo.UsedBytes(userID)
	if err != nil {
		return "", err
	}
	prev, err := h.repo.ByteLen(userID, id)
	if err != nil {
		return "", err
	}
	if used-prev+byteLen > h.quotaBytes {
		return "", &StoreError{http.StatusRequestEntityTooLarge, "drawing quota exceeded"}
	}

	changed, err := h.repo.Upsert(userID, Drawing{
		ID: id, Scene: b.Scene, SVG: b.SVG, ByteLen: byteLen,
		Width: b.Width, Height: b.Height, CreatedAt: b.CreatedAt, UpdatedAt: b.UpdatedAt,
	})
	if err != nil {
		return "", err
	}
	if !changed {
		return "ignored", nil
	}
	if h.notify != nil {
		h.notify(ctx, userID, "upsert", id)
	}
	return "stored", nil
}

// Repo expõe o repositório (leitura de desenhos pelo MCP).
func (h *Handler) Repo() *Repository { return h.repo }

// GET /api/drawings/{id}
func (h *Handler) Get(w http.ResponseWriter, r *http.Request) {
	userID := auth.GetUserID(r)
	d, err := h.repo.Get(userID, chi.URLParam(r, "id"))
	if err != nil {
		jsonError(w, http.StatusInternalServerError, err.Error())
		return
	}
	if d == nil {
		jsonError(w, http.StatusNotFound, "not found")
		return
	}
	jsonOK(w, d)
}

// GET /api/drawings/manifest
func (h *Handler) Manifest(w http.ResponseWriter, r *http.Request) {
	userID := auth.GetUserID(r)
	entries, err := h.repo.Manifest(userID)
	if err != nil {
		jsonError(w, http.StatusInternalServerError, err.Error())
		return
	}
	used, err := h.repo.UsedBytes(userID)
	if err != nil {
		jsonError(w, http.StatusInternalServerError, err.Error())
		return
	}
	jsonOK(w, map[string]any{
		"drawings":    entries,
		"used_bytes":  used,
		"quota_bytes": h.quotaBytes,
	})
}

// DELETE /api/drawings/{id}
func (h *Handler) Delete(w http.ResponseWriter, r *http.Request) {
	userID := auth.GetUserID(r)
	id := chi.URLParam(r, "id")
	if err := h.repo.MarkOrphan(userID, id, time.Now().UnixMilli()); err != nil {
		if err.Error() == "not found" {
			jsonError(w, http.StatusNotFound, "not found")
			return
		}
		jsonError(w, http.StatusInternalServerError, err.Error())
		return
	}
	if h.notify != nil {
		h.notify(r.Context(), userID, "delete", id)
	}
	w.WriteHeader(http.StatusNoContent)
}

// ValidateScene aceita a cena do editor novo (`zk-sketch`, versão 1, com `strokes`
// em array) e a do editor antigo (`excalidraw`), que continua valendo como legado:
// rejeitar o que já foi sincronizado quebraria o pull dos outros dispositivos. O
// servidor não renderiza a cena, então não confere os pontos — o teto de 5 MB e o
// parse do cliente já os limitam.
func ValidateScene(scene string) error {
	if scene == "" {
		return errors.New("scene is required")
	}
	var head struct {
		Type    string          `json:"type"`
		Version *float64        `json:"version"`
		Strokes json.RawMessage `json:"strokes"`
	}
	if err := json.Unmarshal([]byte(scene), &head); err != nil {
		return errors.New("scene is not valid json")
	}
	switch head.Type {
	case "excalidraw":
		return nil
	case "zk-sketch":
		if head.Version == nil || *head.Version != 1 {
			return errors.New("scene version must be 1")
		}
		if t := bytes.TrimSpace(head.Strokes); len(t) == 0 || t[0] != '[' {
			return errors.New("scene strokes must be an array")
		}
		return nil
	default:
		return errors.New("scene type must be zk-sketch")
	}
}

var (
	cssExternalRE = regexp.MustCompile(`(?i)@import|url\(\s*['"]?\s*(https?:|//)`)
	// SVG de preview só pode referenciar a si mesmo (#id) ou embutir dados (data:).
	externalRefRE = regexp.MustCompile(`(?i)^\s*(https?:|//|javascript:|ftp:|file:)`)
)

// ValidateSVG confere que o preview é XML bem formado e inofensivo: sem
// <script>, sem <foreignObject>, sem atributos on*, sem href externo e sem CSS
// que busque recurso externo. O cliente ainda renderiza em <img> (que não
// executa script) — isto é defesa em profundidade para SVG vindo de outro device.
func ValidateSVG(svg string) error {
	if strings.TrimSpace(svg) == "" {
		return errors.New("svg is required")
	}
	dec := xml.NewDecoder(strings.NewReader(svg))
	dec.Strict = true
	// O decoder do Go não resolve entidades externas/DTD; entidades customizadas
	// falham em modo estrito.
	sawRoot := false
	inStyle := false
	for {
		tok, err := dec.Token()
		if err == io.EOF {
			break
		}
		if err != nil {
			return errors.New("svg is not well-formed xml")
		}
		switch t := tok.(type) {
		case xml.StartElement:
			name := strings.ToLower(t.Name.Local)
			if !sawRoot {
				if name != "svg" {
					return errors.New("svg root element must be <svg>")
				}
				sawRoot = true
			}
			switch name {
			case "script", "foreignobject", "iframe", "embed", "object":
				return errors.New("svg contains forbidden element <" + t.Name.Local + ">")
			case "style":
				inStyle = true
			}
			for _, a := range t.Attr {
				an := strings.ToLower(a.Name.Local)
				if strings.HasPrefix(an, "on") {
					return errors.New("svg contains event handler attribute")
				}
				if an == "href" && externalRefRE.MatchString(a.Value) {
					return errors.New("svg references an external resource")
				}
				if an == "style" && cssExternalRE.MatchString(a.Value) {
					return errors.New("svg references an external resource")
				}
			}
		case xml.EndElement:
			if strings.ToLower(t.Name.Local) == "style" {
				inStyle = false
			}
		case xml.CharData:
			if inStyle && cssExternalRE.Match(t) {
				return errors.New("svg references an external resource")
			}
		case xml.Directive:
			// <!DOCTYPE ...> / <!ENTITY ...> não têm lugar num preview.
			return errors.New("svg contains a directive")
		}
	}
	if !sawRoot {
		return errors.New("svg root element must be <svg>")
	}
	return nil
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
