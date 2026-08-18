package portability

import (
	"archive/zip"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"regexp"
	"strings"
	"time"

	"github.com/brunofullstack/zettelkasten/api/internal/auth"
	"github.com/brunofullstack/zettelkasten/api/internal/models"
	"github.com/brunofullstack/zettelkasten/api/internal/zettel"
	"github.com/go-chi/chi/v5"
)

const maxImportBytes = 50 << 20 // 50 MB

// UserLookup allows the portability handler to resolve a backup key to a user
// without importing the auth package directly.
type UserLookup interface {
	FindUserByBackupKeyHash(keyHash string) (*models.User, error)
}

type Handler struct {
	repo       *zettel.Repository
	userLookup UserLookup
}

func NewHandler(repo *zettel.Repository, userLookup UserLookup) *Handler {
	return &Handler{repo: repo, userLookup: userLookup}
}

func (h *Handler) Routes() chi.Router {
	r := chi.NewRouter()
	r.Get("/export/json", h.exportJSON)
	r.Get("/export/markdown", h.exportMarkdown)
	r.Post("/import/json", h.importJSON)
	return r
}

type exportPayload struct {
	Version    int             `json:"version"`
	ExportedAt string          `json:"exported_at"`
	Zettels    []models.Zettel `json:"zettels"`
	Links      []models.Link   `json:"links"`
}

// GET /api/backup/export?key=<64-hex-char-key>
// Public endpoint — authenticated via the backup key instead of JWT.
func (h *Handler) BackupExport(w http.ResponseWriter, r *http.Request) {
	rawKey := r.URL.Query().Get("key")
	if len(rawKey) != 64 {
		jsonError(w, http.StatusUnauthorized, "missing or invalid key")
		return
	}
	sum := sha256.Sum256([]byte(rawKey))
	keyHash := hex.EncodeToString(sum[:])

	user, err := h.userLookup.FindUserByBackupKeyHash(keyHash)
	if err != nil || user == nil {
		jsonError(w, http.StatusUnauthorized, "invalid key")
		return
	}

	h.exportJSONForUser(w, user.ID)
}

// GET /api/export/json
func (h *Handler) exportJSON(w http.ResponseWriter, r *http.Request) {
	h.exportJSONForUser(w, auth.GetUserID(r))
}

func (h *Handler) exportJSONForUser(w http.ResponseWriter, userID string) {
	zettels, err := h.repo.List(userID, 0, "")
	if err != nil {
		jsonError(w, http.StatusInternalServerError, err.Error())
		return
	}

	links, err := h.repo.GetAllLinks(userID)
	if err != nil {
		jsonError(w, http.StatusInternalServerError, err.Error())
		return
	}

	// Strip user_id before export
	for i := range zettels {
		zettels[i].UserID = ""
	}

	payload := exportPayload{
		Version:    1,
		ExportedAt: time.Now().UTC().Format(time.RFC3339),
		Zettels:    zettels,
		Links:      links,
	}

	date := time.Now().Format("2006-01-02")
	filename := fmt.Sprintf("zettelkasten-backup-%s.json", date)

	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Content-Disposition", fmt.Sprintf(`attachment; filename="%s"`, filename))
	json.NewEncoder(w).Encode(payload)
}

// GET /api/export/markdown
func (h *Handler) exportMarkdown(w http.ResponseWriter, r *http.Request) {
	userID := auth.GetUserID(r)

	zettels, err := h.repo.List(userID, 0, "")
	if err != nil {
		jsonError(w, http.StatusInternalServerError, err.Error())
		return
	}

	links, err := h.repo.GetAllLinks(userID)
	if err != nil {
		jsonError(w, http.StatusInternalServerError, err.Error())
		return
	}

	date := time.Now().Format("2006-01-02")
	filename := fmt.Sprintf("zettelkasten-export-%s.zip", date)

	w.Header().Set("Content-Type", "application/zip")
	w.Header().Set("Content-Disposition", fmt.Sprintf(`attachment; filename="%s"`, filename))

	zw := zip.NewWriter(w)
	defer zw.Close()

	seen := map[string]int{}
	for _, z := range zettels {
		base := sanitizeFilename(z.Title)
		seen[base]++
		fname := base
		if seen[base] > 1 {
			fname = fmt.Sprintf("%s-%d", base, seen[base])
		}
		f, err := zw.Create(fname + ".md")
		if err != nil {
			continue
		}
		writeMarkdownFile(f, z)
	}

	indexFile, err := zw.Create("index.json")
	if err == nil {
		json.NewEncoder(indexFile).Encode(links)
	}
}

// POST /api/import/json
func (h *Handler) importJSON(w http.ResponseWriter, r *http.Request) {
	userID := auth.GetUserID(r)

	r.Body = http.MaxBytesReader(w, r.Body, maxImportBytes)

	var payload exportPayload
	if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
		jsonError(w, http.StatusBadRequest, "invalid json: "+err.Error())
		return
	}

	if payload.Version != 1 {
		jsonError(w, http.StatusBadRequest, fmt.Sprintf("unsupported version: %d", payload.Version))
		return
	}

	imported, skipped, done, errs, err := h.repo.BulkImport(userID, payload.Zettels)
	if err != nil {
		jsonError(w, http.StatusInternalServerError, err.Error())
		return
	}

	// Rebuild links only for imported/updated zettels
	for _, z := range done {
		h.syncLinks(userID, z.ID, z.Body)
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]any{
		"imported": imported,
		"skipped":  skipped,
		"errors":   errs,
	})
}

// syncLinks resolves [[wiki link]] titles to IDs and upserts the links table.
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

var (
	nonAlphaNum = regexp.MustCompile(`[^a-z0-9\-]`)
	multiDash   = regexp.MustCompile(`-+`)
)

func sanitizeFilename(title string) string {
	s := strings.ToLower(title)
	s = strings.ReplaceAll(s, " ", "-")
	s = nonAlphaNum.ReplaceAllString(s, "")
	s = multiDash.ReplaceAllString(s, "-")
	s = strings.Trim(s, "-")
	if len(s) > 80 {
		s = s[:80]
	}
	if s == "" {
		s = "zettel"
	}
	return s
}

func writeMarkdownFile(w io.Writer, z models.Zettel) {
	createdAt := time.UnixMilli(z.CreatedAt).UTC().Format(time.RFC3339)
	updatedAt := time.UnixMilli(z.UpdatedAt).UTC().Format(time.RFC3339)
	tagsJSON, _ := json.Marshal(z.Tags)
	fmt.Fprintf(w, "---\nid: %s\ntags: %s\ncreated_at: %s\nupdated_at: %s\n---\n\n# %s\n\n%s\n",
		z.ID, string(tagsJSON), createdAt, updatedAt, z.Title, z.Body)
}

type parsedLink struct {
	title       string
	isParentRef bool
}

func parseLinkTitles(body string) []parsedLink {
	var links []parsedLink
	for {
		start := strings.Index(body, "[[")
		if start == -1 {
			break
		}
		end := strings.Index(body[start:], "]]")
		if end == -1 {
			break
		}
		inner := body[start+2 : start+end]
		if pipeIdx := strings.Index(inner, "|"); pipeIdx != -1 {
			inner = inner[:pipeIdx]
		}
		isParentRef := strings.HasPrefix(inner, "^")
		title := inner
		if isParentRef {
			title = inner[1:]
		}
		if title != "" {
			links = append(links, parsedLink{title: title, isParentRef: isParentRef})
		}
		body = body[start+end+2:]
	}
	return links
}

func jsonError(w http.ResponseWriter, status int, msg string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(map[string]string{"error": msg})
}
