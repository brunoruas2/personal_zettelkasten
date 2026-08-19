package portability

import (
	"archive/zip"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"path"
	"strings"
	"time"

	"github.com/brunofullstack/zettelkasten/api/internal/auth"
	"github.com/brunofullstack/zettelkasten/api/internal/images"
	"github.com/brunofullstack/zettelkasten/api/internal/zettel"
)

// imageDir é a pasta das imagens dentro do pacote ZIP.
const imageDir = "images"

// GET /api/export/zip
// Backup completo: zettels.json + um arquivo por imagem. É o único caminho que
// leva os bytes das imagens — o export JSON carrega apenas metadados.
func (h *Handler) exportZip(w http.ResponseWriter, r *http.Request) {
	h.exportZipForUser(w, auth.GetUserID(r))
}

func (h *Handler) exportZipForUser(w http.ResponseWriter, userID string) {
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
	for i := range zettels {
		zettels[i].UserID = ""
	}

	date := time.Now().Format("2006-01-02")
	w.Header().Set("Content-Type", "application/zip")
	w.Header().Set("Content-Disposition",
		fmt.Sprintf(`attachment; filename="zettelkasten-backup-%s.zip"`, date))

	// zip.NewWriter escreve direto no ResponseWriter e as imagens são lidas uma
	// por vez do banco: o pico de memória não cresce com o tamanho do acervo.
	zw := zip.NewWriter(w)
	defer zw.Close()

	payload := exportPayload{
		Version:    1,
		ExportedAt: time.Now().UTC().Format(time.RFC3339),
		Zettels:    zettels,
		Links:      links,
		Images:     h.imageManifest(userID),
	}
	if f, err := zw.Create("zettels.json"); err == nil {
		json.NewEncoder(f).Encode(payload)
	}

	h.writeImageEntries(zw, userID)
}

// POST /api/import/zip
func (h *Handler) importZip(w http.ResponseWriter, r *http.Request) {
	userID := auth.GetUserID(r)

	r.Body = http.MaxBytesReader(w, r.Body, maxImportZipBytes)

	// zip.NewReader exige io.ReaderAt, então o upload precisa ser materializado.
	// Vai para arquivo temporário, nunca para a RAM do VPS.
	tmp, err := os.CreateTemp("", "zettel-import-*.zip")
	if err != nil {
		jsonError(w, http.StatusInternalServerError, "could not create temp file")
		return
	}
	defer os.Remove(tmp.Name())
	defer tmp.Close()

	size, err := io.Copy(tmp, r.Body)
	if err != nil {
		jsonError(w, http.StatusBadRequest, "could not read upload: "+err.Error())
		return
	}

	zr, err := zip.NewReader(tmp, size)
	if err != nil {
		jsonError(w, http.StatusBadRequest, "invalid zip: "+err.Error())
		return
	}

	var payload *exportPayload
	errs := []string{}

	// Imagens primeiro: assim os zettels importados em seguida já encontram os
	// blobs ao sincronizar as referências.
	for _, f := range zr.File {
		if f.FileInfo().IsDir() {
			continue
		}
		name := path.Clean(f.Name)
		switch {
		case name == "zettels.json":
			p, err := readPayload(f)
			if err != nil {
				errs = append(errs, "zettels.json: "+err.Error())
				continue
			}
			payload = p
		case strings.HasPrefix(name, imageDir+"/"):
			if err := h.importImageEntry(userID, f); err != nil {
				errs = append(errs, f.Name+": "+err.Error())
			}
		}
	}

	if payload == nil {
		jsonError(w, http.StatusBadRequest, "zip has no zettels.json")
		return
	}
	if payload.Version != 1 {
		jsonError(w, http.StatusBadRequest, fmt.Sprintf("unsupported version: %d", payload.Version))
		return
	}

	imported, skipped, done, importErrs, err := h.repo.BulkImport(userID, payload.Zettels)
	if err != nil {
		jsonError(w, http.StatusInternalServerError, err.Error())
		return
	}
	errs = append(errs, importErrs...)

	for _, z := range done {
		h.syncLinks(userID, z.ID, z.Body)
		h.syncImageRefs(userID, z.ID, z.Body)
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]any{
		"imported": imported,
		"skipped":  skipped,
		"errors":   errs,
	})
}

// --- helpers de imagem ---

func (h *Handler) imageManifest(userID string) []images.Meta {
	if h.images == nil {
		return nil
	}
	metas, err := h.images.Manifest(userID)
	if err != nil {
		return nil
	}
	return metas
}

// imagePathMap mapeia id -> caminho relativo dentro do pacote.
func (h *Handler) imagePathMap(userID string) map[string]string {
	paths := map[string]string{}
	for _, m := range h.imageManifest(userID) {
		paths[m.ID] = imageDir + "/" + m.ID + extForMime(m.Mime)
	}
	return paths
}

// writeImageEntries grava um arquivo por imagem, lendo um blob por vez.
func (h *Handler) writeImageEntries(zw *zip.Writer, userID string) {
	if h.images == nil {
		return
	}
	for _, m := range h.imageManifest(userID) {
		_, data, err := h.images.Get(userID, m.ID)
		if err != nil || data == nil {
			continue
		}
		f, err := zw.Create(imageDir + "/" + m.ID + extForMime(m.Mime))
		if err != nil {
			continue
		}
		f.Write(data)
	}
}

func (h *Handler) importImageEntry(userID string, f *zip.File) error {
	if h.images == nil {
		return nil
	}
	base := path.Base(f.Name)
	id := strings.TrimSuffix(base, path.Ext(base))
	if len(id) != images.IDLength {
		return fmt.Errorf("invalid image id")
	}

	rc, err := f.Open()
	if err != nil {
		return err
	}
	defer rc.Close()

	data, err := io.ReadAll(io.LimitReader(rc, images.MaxUploadBytes+1))
	if err != nil {
		return err
	}
	if int64(len(data)) > images.MaxUploadBytes {
		return fmt.Errorf("image exceeds size limit")
	}

	// O id vem do nome do arquivo, que é editável dentro do ZIP. Sem conferir o
	// hash, um pacote adulterado gravaria bytes sob um id que não é o deles e as
	// referências zk:img/ do body passariam a apontar para a imagem errada.
	sum := sha256.Sum256(data)
	if hex.EncodeToString(sum[:])[:images.IDLength] != id {
		return fmt.Errorf("content hash does not match filename")
	}

	return h.images.Insert(userID, images.Meta{
		ID:        id,
		Mime:      mimeForExt(path.Ext(base)),
		ByteLen:   int64(len(data)),
		CreatedAt: time.Now().UnixMilli(),
	}, data)
}

// syncImageRefs espelha o de zettel.Handler — o import precisa reconciliar as
// referências pelos mesmos critérios das rotas de CRUD.
func (h *Handler) syncImageRefs(userID, zettelID, body string) {
	if h.images == nil {
		return
	}
	_ = h.images.SyncRefs(userID, zettelID, zettel.ParseImageIDs(body), time.Now().UnixMilli())
}

// rewriteImageRefs troca zk:img/<id> pelo caminho relativo no pacote.
func rewriteImageRefs(body string, paths map[string]string) string {
	if len(paths) == 0 {
		return body
	}
	for id, p := range paths {
		body = strings.ReplaceAll(body, "zk:img/"+id, p)
	}
	return body
}

func readPayload(f *zip.File) (*exportPayload, error) {
	rc, err := f.Open()
	if err != nil {
		return nil, err
	}
	defer rc.Close()

	var p exportPayload
	if err := json.NewDecoder(io.LimitReader(rc, maxImportBytes)).Decode(&p); err != nil {
		return nil, err
	}
	return &p, nil
}

func extForMime(mime string) string {
	switch mime {
	case "image/webp":
		return ".webp"
	case "image/png":
		return ".png"
	case "image/jpeg":
		return ".jpg"
	case "image/gif":
		return ".gif"
	case "image/svg+xml":
		return ".svg"
	}
	return ".bin"
}

func mimeForExt(ext string) string {
	switch strings.ToLower(ext) {
	case ".webp":
		return "image/webp"
	case ".png":
		return "image/png"
	case ".jpg", ".jpeg":
		return "image/jpeg"
	case ".gif":
		return "image/gif"
	case ".svg":
		return "image/svg+xml"
	}
	return "application/octet-stream"
}
