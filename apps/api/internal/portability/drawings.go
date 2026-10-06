package portability

import (
	"archive/zip"
	"fmt"
	"io"
	"path"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/brunofullstack/zettelkasten/api/internal/drawings"
	"github.com/brunofullstack/zettelkasten/api/internal/zettel"
)

// drawingDir é a pasta dos desenhos dentro do pacote ZIP: para cada id,
// `<id>.excalidraw` (a cena, reeditável) e `<id>.svg` (o preview).
const drawingDir = "drawings"

const (
	sceneExt = ".excalidraw"
	svgExt   = ".svg"
)

var (
	drawingIDRE  = regexp.MustCompile(`^[A-Za-z0-9]{1,64}$`)
	svgWidthRE   = regexp.MustCompile(`(?i)<svg[^>]*\swidth="([0-9.]+)`)
	svgHeightRE  = regexp.MustCompile(`(?i)<svg[^>]*\sheight="([0-9.]+)`)
	drawingRefRE = regexp.MustCompile(`zk:draw/([A-Za-z0-9]{1,64})`)
)

// WithDrawings liga desenhos ao export/import. Opcional: sem isto o pacote
// simplesmente não carrega desenhos (comportamento anterior a esta change).
func (h *Handler) WithDrawings(repo *drawings.Repository, quotaBytes int64) *Handler {
	h.drawings = repo
	h.drawingQuota = quotaBytes
	return h
}

// drawingManifest devolve só metadados (id, updated_at, byte_len), nunca a cena:
// o JSON de export não pode carregar o conteúdo, que pode ser grande.
func (h *Handler) drawingManifest(userID string) []drawings.ManifestEntry {
	if h.drawings == nil {
		return nil
	}
	entries, err := h.drawings.Manifest(userID)
	if err != nil {
		return nil
	}
	return entries
}

// writeDrawingEntries grava cena e SVG de cada desenho, lendo um por vez do
// banco: o pico de memória não cresce com o tamanho do acervo.
func (h *Handler) writeDrawingEntries(zw *zip.Writer, userID string, withScene bool) {
	if h.drawings == nil {
		return
	}
	for _, e := range h.drawingManifest(userID) {
		d, err := h.drawings.Get(userID, e.ID)
		if err != nil || d == nil {
			continue
		}
		if withScene {
			if f, err := zw.Create(drawingDir + "/" + d.ID + sceneExt); err == nil {
				io.WriteString(f, d.Scene)
			}
		}
		if f, err := zw.Create(drawingDir + "/" + d.ID + svgExt); err == nil {
			io.WriteString(f, d.SVG)
		}
	}
}

// drawingPathMap mapeia id -> caminho relativo do SVG dentro do pacote.
func (h *Handler) drawingPathMap(userID string) map[string]string {
	paths := map[string]string{}
	for _, e := range h.drawingManifest(userID) {
		paths[e.ID] = drawingDir + "/" + e.ID + svgExt
	}
	return paths
}

// rewriteDrawingRefs troca zk:draw/<id> pelo caminho relativo do SVG no pacote.
func rewriteDrawingRefs(body string, paths map[string]string) string {
	if len(paths) == 0 {
		return body
	}
	return drawingRefRE.ReplaceAllStringFunc(body, func(m string) string {
		id := strings.TrimPrefix(m, "zk:draw/")
		if p, ok := paths[id]; ok {
			return p
		}
		return m
	})
}

// syncDrawingRefs espelha o de zettel.Handler — o import precisa reconciliar as
// referências pelos mesmos critérios das rotas de CRUD.
func (h *Handler) syncDrawingRefs(userID, zettelID, body string) {
	if h.drawings == nil {
		return
	}
	_ = h.drawings.SyncRefs(userID, zettelID, zettel.ParseDrawingIDs(body), time.Now().UnixMilli())
}

// pendingDrawing junta os dois arquivos de um mesmo id enquanto o ZIP é lido.
type pendingDrawing struct {
	scene   string
	svg     string
	hasData bool
}

// collectDrawingEntry lê um arquivo de `drawings/` para o mapa de pendentes. O
// id vem do nome do arquivo, editável dentro do ZIP, então é validado.
func collectDrawingEntry(f *zip.File, into map[string]*pendingDrawing) error {
	base := path.Base(f.Name)
	ext := strings.ToLower(path.Ext(base))
	id := strings.TrimSuffix(base, path.Ext(base))
	if ext != sceneExt && ext != svgExt {
		return fmt.Errorf("unexpected file in drawings/")
	}
	if !drawingIDRE.MatchString(id) {
		return fmt.Errorf("invalid drawing id")
	}

	rc, err := f.Open()
	if err != nil {
		return err
	}
	defer rc.Close()

	data, err := io.ReadAll(io.LimitReader(rc, drawings.MaxDrawingBytes+1))
	if err != nil {
		return err
	}
	if int64(len(data)) > drawings.MaxDrawingBytes {
		return fmt.Errorf("drawing exceeds size limit")
	}

	p := into[id]
	if p == nil {
		p = &pendingDrawing{}
		into[id] = p
	}
	p.hasData = true
	if ext == sceneExt {
		p.scene = string(data)
	} else {
		p.svg = string(data)
	}
	return nil
}

// importDrawings valida e grava os desenhos coletados do ZIP, com as mesmas
// regras do PUT (teto, cena do Excalidraw, SVG inofensivo, quota). Roda antes
// dos zettels, para as referências encontrarem as linhas ao reconciliar.
func (h *Handler) importDrawings(userID string, pending map[string]*pendingDrawing) []string {
	errs := []string{}
	if h.drawings == nil || len(pending) == 0 {
		return errs
	}
	used, err := h.drawings.UsedBytes(userID)
	if err != nil {
		return append(errs, "drawings: "+err.Error())
	}

	now := time.Now().UnixMilli()
	for id, p := range pending {
		name := drawingDir + "/" + id
		if p.scene == "" || p.svg == "" {
			errs = append(errs, name+": needs both "+sceneExt+" and "+svgExt)
			continue
		}
		if err := drawings.ValidateScene(p.scene); err != nil {
			errs = append(errs, name+": "+err.Error())
			continue
		}
		if err := drawings.ValidateSVG(p.svg); err != nil {
			errs = append(errs, name+": "+err.Error())
			continue
		}
		byteLen := int64(len(p.scene) + len(p.svg))
		if byteLen > drawings.MaxDrawingBytes {
			errs = append(errs, name+": drawing exceeds size limit")
			continue
		}
		prev, err := h.drawings.ByteLen(userID, id)
		if err != nil {
			errs = append(errs, name+": "+err.Error())
			continue
		}
		if h.drawingQuota > 0 && used-prev+byteLen > h.drawingQuota {
			errs = append(errs, name+": drawing quota exceeded")
			continue
		}
		if _, err := h.drawings.Upsert(userID, drawings.Drawing{
			ID:        id,
			Scene:     p.scene,
			SVG:       p.svg,
			ByteLen:   byteLen,
			Width:     svgDimension(svgWidthRE, p.svg),
			Height:    svgDimension(svgHeightRE, p.svg),
			CreatedAt: now,
			UpdatedAt: now,
		}); err != nil {
			errs = append(errs, name+": "+err.Error())
			continue
		}
		used += byteLen - prev
	}
	return errs
}

func svgDimension(re *regexp.Regexp, svg string) int {
	m := re.FindStringSubmatch(svg)
	if m == nil {
		return 0
	}
	f, err := strconv.ParseFloat(m[1], 64)
	if err != nil || f < 0 || f > 1_000_000 {
		return 0
	}
	return int(f)
}
