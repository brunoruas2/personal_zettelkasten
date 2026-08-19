package images

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/brunofullstack/zettelkasten/api/internal/auth"
	"github.com/go-chi/chi/v5"
)

// MaxUploadBytes é o teto duro por imagem. O alvo do compressor no cliente é
// 120 KB — a folga cobre SVG e browsers que caem em JPEG por não encodar WebP.
const MaxUploadBytes int64 = 512 << 10

// IDLength é o tamanho do id: sha256 do conteúdo truncado em 128 bits.
const IDLength = 32

type Handler struct {
	repo       *Repository
	quotaBytes int64
}

func NewHandler(repo *Repository, quotaBytes int64) *Handler {
	return &Handler{repo: repo, quotaBytes: quotaBytes}
}

// POST /api/images/{id}
// Corpo = bytes crus da imagem. Sem multipart: o único arquivo já é nomeado
// pela URL, e a API não tem plumbing de form em lugar nenhum.
func (h *Handler) Upload(w http.ResponseWriter, r *http.Request) {
	userID := auth.GetUserID(r)
	id := chi.URLParam(r, "id")

	if !validID(id) {
		jsonError(w, http.StatusBadRequest, "invalid image id")
		return
	}

	// Reenviar o que já existe é no-op — é o caminho do dedup e torna o retry
	// da fila offline seguro por construção. Insert limpa orphaned_at.
	exists, err := h.repo.Exists(userID, id)
	if err != nil {
		jsonError(w, http.StatusInternalServerError, err.Error())
		return
	}

	r.Body = http.MaxBytesReader(w, r.Body, MaxUploadBytes)
	data, err := io.ReadAll(r.Body)
	if err != nil {
		var tooLarge *http.MaxBytesError
		if errors.As(err, &tooLarge) {
			jsonError(w, http.StatusRequestEntityTooLarge, "image exceeds 512 KB")
			return
		}
		jsonError(w, http.StatusBadRequest, "could not read body")
		return
	}
	if len(data) == 0 {
		jsonError(w, http.StatusBadRequest, "empty body")
		return
	}

	mime := sniffMime(data)
	if mime == "" {
		jsonError(w, http.StatusBadRequest, "unsupported image format")
		return
	}

	sum := sha256.Sum256(data)
	if hex.EncodeToString(sum[:])[:IDLength] != id {
		jsonError(w, http.StatusBadRequest, "content hash does not match id")
		return
	}

	if exists {
		// Bytes já estão gravados; só ressuscita se estava órfã.
		if err := h.repo.Insert(userID, Meta{
			ID: id, Mime: mime, ByteLen: int64(len(data)), CreatedAt: time.Now().UnixMilli(),
		}, data); err != nil {
			jsonError(w, http.StatusInternalServerError, err.Error())
			return
		}
		jsonOK(w, map[string]string{"id": id, "status": "exists"})
		return
	}

	used, err := h.repo.UsedBytes(userID)
	if err != nil {
		jsonError(w, http.StatusInternalServerError, err.Error())
		return
	}
	if used+int64(len(data)) > h.quotaBytes {
		jsonError(w, http.StatusRequestEntityTooLarge, "image quota exceeded")
		return
	}

	m := Meta{
		ID:        id,
		Mime:      mime,
		Width:     parseIntHeader(r, "X-Image-Width"),
		Height:    parseIntHeader(r, "X-Image-Height"),
		ByteLen:   int64(len(data)),
		CreatedAt: time.Now().UnixMilli(),
	}
	if err := h.repo.Insert(userID, m, data); err != nil {
		jsonError(w, http.StatusInternalServerError, err.Error())
		return
	}

	w.WriteHeader(http.StatusCreated)
	jsonOK(w, m)
}

// GET /api/images/{id}
func (h *Handler) Get(w http.ResponseWriter, r *http.Request) {
	userID := auth.GetUserID(r)
	id := chi.URLParam(r, "id")

	m, data, err := h.repo.Get(userID, id)
	if err != nil {
		jsonError(w, http.StatusInternalServerError, err.Error())
		return
	}
	if m == nil {
		jsonError(w, http.StatusNotFound, "not found")
		return
	}

	// Content-addressed: o conteúdo daquele id nunca muda, então pode ser
	// cacheado para sempre e revalidado só pelo ETag.
	w.Header().Set("Content-Type", m.Mime)
	w.Header().Set("ETag", `"`+m.ID+`"`)
	w.Header().Set("Cache-Control", "private, max-age=31536000, immutable")
	http.ServeContent(w, r, "", time.UnixMilli(m.CreatedAt), bytes.NewReader(data))
}

// GET /api/images/manifest
func (h *Handler) Manifest(w http.ResponseWriter, r *http.Request) {
	userID := auth.GetUserID(r)

	metas, err := h.repo.Manifest(userID)
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
		"images":      metas,
		"used_bytes":  used,
		"quota_bytes": h.quotaBytes,
	})
}

// DELETE /api/images/{id}
func (h *Handler) Delete(w http.ResponseWriter, r *http.Request) {
	userID := auth.GetUserID(r)

	if err := h.repo.MarkOrphan(userID, chi.URLParam(r, "id"), time.Now().UnixMilli()); err != nil {
		if err.Error() == "not found" {
			jsonError(w, http.StatusNotFound, "not found")
			return
		}
		jsonError(w, http.StatusInternalServerError, err.Error())
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// --- helpers ---

func validID(id string) bool {
	if len(id) != IDLength {
		return false
	}
	for i := 0; i < len(id); i++ {
		c := id[i]
		if (c < '0' || c > '9') && (c < 'a' || c > 'f') {
			return false
		}
	}
	return true
}

// sniffMime identifica o formato pelos magic bytes. Devolve "" quando o
// conteúdo não é uma imagem aceita.
func sniffMime(data []byte) string {
	switch {
	case len(data) >= 12 && bytes.Equal(data[0:4], []byte("RIFF")) && bytes.Equal(data[8:12], []byte("WEBP")):
		return "image/webp"
	case len(data) >= 8 && bytes.Equal(data[0:8], []byte{0x89, 'P', 'N', 'G', 0x0D, 0x0A, 0x1A, 0x0A}):
		return "image/png"
	case len(data) >= 3 && bytes.Equal(data[0:3], []byte{0xFF, 0xD8, 0xFF}):
		return "image/jpeg"
	case len(data) >= 6 && (bytes.Equal(data[0:6], []byte("GIF87a")) || bytes.Equal(data[0:6], []byte("GIF89a"))):
		return "image/gif"
	}
	// SVG é texto: pode começar com a declaração XML, um comentário ou a tag.
	head := strings.TrimSpace(string(data[:min(len(data), 256)]))
	if strings.HasPrefix(head, "<?xml") || strings.HasPrefix(head, "<svg") || strings.HasPrefix(head, "<!--") {
		if strings.Contains(strings.ToLower(string(data[:min(len(data), 1024)])), "<svg") {
			return "image/svg+xml"
		}
	}
	return ""
}

func parseIntHeader(r *http.Request, name string) int {
	n, err := strconv.Atoi(r.Header.Get(name))
	if err != nil || n < 0 || n > 1_000_000 {
		return 0
	}
	return n
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
