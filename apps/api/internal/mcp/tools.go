package mcp

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"sort"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/brunofullstack/zettelkasten/api/internal/drawings"
	"github.com/brunofullstack/zettelkasten/api/internal/models"
	"github.com/brunofullstack/zettelkasten/api/internal/zettel"
	sdk "github.com/modelcontextprotocol/go-sdk/mcp"
)

// maxLimit é o teto de resultados de busca e listagem.
const maxLimit = 50

type tools struct {
	svc      *zettel.Service
	drawings *drawings.Handler
	userID   string
}

func boolPtr(b bool) *bool { return &b }

func readOnly(title string) *sdk.ToolAnnotations {
	return &sdk.ToolAnnotations{Title: title, ReadOnlyHint: true, OpenWorldHint: boolPtr(false)}
}

func writes(title string, destructive, idempotent bool) *sdk.ToolAnnotations {
	return &sdk.ToolAnnotations{
		Title: title, DestructiveHint: boolPtr(destructive), IdempotentHint: idempotent, OpenWorldHint: boolPtr(false),
	}
}

func (t *tools) register(s *sdk.Server) {
	sdk.AddTool(s, &sdk.Tool{
		Name:        "search_zettels",
		Description: "Busca zettels por texto (título, corpo e tags; cada palavra casa como prefixo, todas obrigatórias). Use antes de criar, para não duplicar. Devolve id, título, tags e um trecho.",
		Annotations: readOnly("Buscar zettels"),
	}, t.search)
	sdk.AddTool(s, &sdk.Tool{
		Name:        "read_zettel",
		Description: "Lê um zettel completo por id ou por título exato (sem diferenciar maiúsculas): corpo em Markdown, tags, datas, os zettels que ele cita e os que o citam. Leia antes de editar.",
		Annotations: readOnly("Ler zettel"),
	}, t.read)
	sdk.AddTool(s, &sdk.Tool{
		Name:        "list_recent",
		Description: "Lista os zettels atualizados mais recentemente (id, título, tags, data).",
		Annotations: readOnly("Zettels recentes"),
	}, t.recent)
	sdk.AddTool(s, &sdk.Tool{
		Name:        "create_zettel",
		Description: "Cria um zettel. Título curto e único (uma ideia por zettel); corpo em Markdown, com [[título]] para ligar a outros zettels e [[^título]] para o pai; tags em kebab-case. Se já existir um zettel com o mesmo título, nada é criado e o id do existente é devolvido.",
		Annotations: writes("Criar zettel", false, false),
	}, t.create)
	sdk.AddTool(s, &sdk.Tool{
		Name:        "edit_zettel",
		Description: "Edita o corpo de um zettel. Modo trecho (preferido): old_string + new_string — old_string precisa aparecer exatamente uma vez no corpo atual (inclua contexto se repetir); new_string vazio apaga o trecho. Modo inteiro: body substitui o corpo todo. Informe um modo só. Não muda título (use rename_zettel) nem tags (use set_tags).",
		Annotations: writes("Editar zettel", false, false),
	}, t.edit)
	sdk.AddTool(s, &sdk.Tool{
		Name:        "set_tags",
		Description: "Acrescenta e/ou remove tags de um zettel. As tags são normalizadas (minúsculas, espaços viram hífen); a ordem das que ficam é preservada.",
		Annotations: writes("Alterar tags", false, true),
	}, t.setTags)
	sdk.AddTool(s, &sdk.Tool{
		Name:        "rename_zettel",
		Description: "Troca o título de um zettel e reescreve [[título]], [[^título]] e [[título|rótulo]] em toda a base, para os links continuarem valendo. Falha se outro zettel já usa o título novo.",
		Annotations: writes("Renomear zettel", false, true),
	}, t.rename)
	sdk.AddTool(s, &sdk.Tool{
		Name:        "delete_zettel",
		Description: "Apaga um zettel (destrutivo: confirme com o usuário antes). A resposta lista os zettels que o citavam, cujos [[links]] ficam sem destino.",
		Annotations: writes("Apagar zettel", true, true),
	}, t.delete)
	sdk.AddTool(s, &sdk.Tool{
		Name:        "get_links",
		Description: "Lista os zettels que um zettel cita (links_to) e os que o citam (linked_from), com títulos. parent=true marca relação de pai ([[^título]]).",
		Annotations: readOnly("Links do zettel"),
	}, t.links)
	sdk.AddTool(s, &sdk.Tool{
		Name:        "list_tags",
		Description: "Lista as tags em uso com a quantidade de zettels de cada uma, da mais usada para a menos.",
		Annotations: readOnly("Tags"),
	}, t.tags)
	sdk.AddTool(s, &sdk.Tool{
		Name:        "read_drawing",
		Description: "Lê um desenho (referenciado no corpo como ![](zk:draw/<id>)): resumo da cena (tipo, traços, cores, área) e o SVG de preview.",
		Annotations: readOnly("Ler desenho"),
	}, t.readDrawing)
	sdk.AddTool(s, &sdk.Tool{
		Name: "write_drawing",
		Description: "Grava um desenho. scene é o JSON (como string) {\"type\":\"zk-sketch\",\"version\":1,\"strokes\":[{\"id\",\"tool\":\"pen\",\"color\",\"size\",\"points\":[[x,y,pressão],…]}]} " +
			"com cores #1e1e1e, #e03131, #2f9e44, #1971c2, #f08c00 ou #9c36b5 e espessuras 2, 4 ou 8. svg é o preview: <svg> com viewBox, <rect> de fundo #ffffff e um <path>/<polyline> por traço, sem script, href externo nem CSS. " +
			"Sem id cria um desenho novo. O desenho só aparece num zettel que o referencie com ![](zk:draw/<id>) (use edit_zettel).",
		Annotations: writes("Gravar desenho", false, false),
	}, t.writeDrawing)
}

// --- tipos de saída ---

type zettelSummary struct {
	ID        string   `json:"id"`
	Title     string   `json:"title"`
	Tags      []string `json:"tags"`
	UpdatedAt string   `json:"updated_at"`
	Snippet   string   `json:"snippet,omitempty"`
}

type zettelFull struct {
	ID         string           `json:"id"`
	Title      string           `json:"title"`
	Tags       []string         `json:"tags"`
	Body       string           `json:"body"`
	CreatedAt  string           `json:"created_at"`
	UpdatedAt  string           `json:"updated_at"`
	LinksTo    []zettel.LinkRef `json:"links_to"`
	LinkedFrom []zettel.LinkRef `json:"linked_from"`
}

type listOut struct {
	Results []zettelSummary `json:"results"`
}

func fmtTime(ms int64) string {
	return time.UnixMilli(ms).UTC().Format(time.RFC3339)
}

func summary(z models.Zettel, snippet string) zettelSummary {
	tags := z.Tags
	if tags == nil {
		tags = []string{}
	}
	return zettelSummary{ID: z.ID, Title: z.Title, Tags: tags, UpdatedAt: fmtTime(z.UpdatedAt), Snippet: snippet}
}

func textResult(format string, args ...any) *sdk.CallToolResult {
	return &sdk.CallToolResult{Content: []sdk.Content{&sdk.TextContent{Text: fmt.Sprintf(format, args...)}}}
}

func tagsText(tags []string) string {
	if len(tags) == 0 {
		return "sem tags"
	}
	return "#" + strings.Join(tags, " #")
}

// domainErr traduz os erros do serviço em mensagens que dizem ao agente o que fazer.
func domainErr(err error, id string) error {
	var pm *zettel.PatchMismatchError
	switch {
	case errors.As(err, &pm) && pm.Count == 0:
		return fmt.Errorf("old_string não aparece no corpo do zettel %s; releia com read_zettel e copie o trecho exato", id)
	case errors.As(err, &pm):
		return fmt.Errorf("old_string aparece %d vezes no corpo do zettel %s; inclua mais contexto para que apareça uma vez só", pm.Count, id)
	case errors.Is(err, zettel.ErrNotFound):
		return fmt.Errorf("zettel não encontrado: %s; use search_zettels para achar o id", id)
	case errors.Is(err, zettel.ErrConflict), errors.Is(err, zettel.ErrInvalid):
		return err
	default:
		return fmt.Errorf("falha interna: %v", err)
	}
}

func clampLimit(n, def int) int {
	if n <= 0 {
		return def
	}
	if n > maxLimit {
		return maxLimit
	}
	return n
}

// snippetFor recorta ~160 caracteres do corpo em volta da primeira palavra da busca.
func snippetFor(body, query string) string {
	body = strings.Join(strings.Fields(body), " ")
	if body == "" {
		return ""
	}
	lower := strings.ToLower(body)
	at := -1
	for _, w := range strings.Fields(strings.ToLower(query)) {
		if i := strings.Index(lower, w); i >= 0 && (at < 0 || i < at) {
			at = i
		}
	}
	runes := []rune(body)
	start := 0
	if at > 0 {
		start = utf8.RuneCountInString(body[:at]) - 60
		if start < 0 {
			start = 0
		}
	}
	end := start + 160
	if end > len(runes) {
		end = len(runes)
	}
	s := string(runes[start:end])
	if start > 0 {
		s = "…" + s
	}
	if end < len(runes) {
		s += "…"
	}
	return s
}

// --- leitura ---

type searchIn struct {
	Query string   `json:"query" jsonschema:"texto a buscar"`
	Tags  []string `json:"tags,omitempty" jsonschema:"só zettels com todas estas tags"`
	Limit int      `json:"limit,omitempty" jsonschema:"máximo de resultados (padrão 20, teto 50)"`
}

func (t *tools) search(_ context.Context, _ *sdk.CallToolRequest, in searchIn) (*sdk.CallToolResult, listOut, error) {
	limit := clampLimit(in.Limit, 20)
	fetch := limit
	if len(in.Tags) > 0 {
		fetch = maxLimit * 4
	}
	zs, err := t.svc.Search(t.userID, in.Query, fetch)
	if err != nil {
		return nil, listOut{}, domainErr(err, "")
	}
	want := make([]string, 0, len(in.Tags))
	for _, tg := range in.Tags {
		if n := zettel.NormalizeTag(tg); n != "" {
			want = append(want, n)
		}
	}
	out := listOut{Results: []zettelSummary{}}
	var b strings.Builder
	for _, z := range zs {
		if !hasAll(z.Tags, want) {
			continue
		}
		s := summary(z, snippetFor(z.Body, in.Query))
		out.Results = append(out.Results, s)
		fmt.Fprintf(&b, "- %s (id %s, %s): %s\n", s.Title, s.ID, tagsText(s.Tags), s.Snippet)
		if len(out.Results) == limit {
			break
		}
	}
	if len(out.Results) == 0 {
		return textResult("Nenhum zettel encontrado para %q.", in.Query), out, nil
	}
	return textResult("%d zettel(s) para %q:\n%s", len(out.Results), in.Query, b.String()), out, nil
}

func hasAll(tags, want []string) bool {
	for _, w := range want {
		found := false
		for _, t := range tags {
			if t == w {
				found = true
				break
			}
		}
		if !found {
			return false
		}
	}
	return true
}

type readIn struct {
	ID    string `json:"id,omitempty" jsonschema:"id do zettel"`
	Title string `json:"title,omitempty" jsonschema:"título exato (sem diferenciar maiúsculas), se não souber o id"`
}

func (t *tools) read(_ context.Context, _ *sdk.CallToolRequest, in readIn) (*sdk.CallToolResult, zettelFull, error) {
	var (
		z   *models.Zettel
		err error
	)
	switch {
	case in.ID != "":
		z, err = t.svc.Get(t.userID, in.ID)
	case strings.TrimSpace(in.Title) != "":
		z, err = t.svc.GetByTitle(t.userID, in.Title)
		if errors.Is(err, zettel.ErrNotFound) {
			return nil, zettelFull{}, fmt.Errorf("nenhum zettel com o título %q; use search_zettels", in.Title)
		}
	default:
		return nil, zettelFull{}, errors.New("informe id ou title")
	}
	if err != nil {
		return nil, zettelFull{}, domainErr(err, in.ID)
	}
	out, in2, err := t.svc.Links(t.userID, z.ID)
	if err != nil {
		return nil, zettelFull{}, domainErr(err, z.ID)
	}
	full := zettelFull{
		ID: z.ID, Title: z.Title, Tags: z.Tags, Body: z.Body,
		CreatedAt: fmtTime(z.CreatedAt), UpdatedAt: fmtTime(z.UpdatedAt),
		LinksTo: out, LinkedFrom: in2,
	}
	if full.Tags == nil {
		full.Tags = []string{}
	}
	return textResult("# %s\nid %s · %s · atualizado %s\nCita: %s\nCitado por: %s\n\n%s",
		z.Title, z.ID, tagsText(full.Tags), full.UpdatedAt, refTitles(out), refTitles(in2), z.Body), full, nil
}

func refTitles(refs []zettel.LinkRef) string {
	if len(refs) == 0 {
		return "nenhum"
	}
	ts := make([]string, len(refs))
	for i, r := range refs {
		ts[i] = "«" + r.Title + "»"
		if r.Parent {
			ts[i] += " (pai)"
		}
	}
	return strings.Join(ts, ", ")
}

type recentIn struct {
	Limit int `json:"limit,omitempty" jsonschema:"máximo de resultados (padrão 20, teto 50)"`
}

func (t *tools) recent(_ context.Context, _ *sdk.CallToolRequest, in recentIn) (*sdk.CallToolResult, listOut, error) {
	zs, err := t.svc.ListRecent(t.userID, clampLimit(in.Limit, 20))
	if err != nil {
		return nil, listOut{}, domainErr(err, "")
	}
	out := listOut{Results: []zettelSummary{}}
	var b strings.Builder
	for _, z := range zs {
		s := summary(z, "")
		out.Results = append(out.Results, s)
		fmt.Fprintf(&b, "- %s (id %s, %s, %s)\n", s.Title, s.ID, tagsText(s.Tags), s.UpdatedAt)
	}
	return textResult("%d zettel(s) recentes:\n%s", len(out.Results), b.String()), out, nil
}

type linksIn struct {
	ID string `json:"id" jsonschema:"id do zettel"`
}

type linksOut struct {
	LinksTo    []zettel.LinkRef `json:"links_to"`
	LinkedFrom []zettel.LinkRef `json:"linked_from"`
}

func (t *tools) links(_ context.Context, _ *sdk.CallToolRequest, in linksIn) (*sdk.CallToolResult, linksOut, error) {
	out, inc, err := t.svc.Links(t.userID, in.ID)
	if err != nil {
		return nil, linksOut{}, domainErr(err, in.ID)
	}
	return textResult("Cita: %s\nCitado por: %s", refTitles(out), refTitles(inc)), linksOut{LinksTo: out, LinkedFrom: inc}, nil
}

type tagsOut struct {
	Tags []zettel.TagCount `json:"tags"`
}

func (t *tools) tags(_ context.Context, _ *sdk.CallToolRequest, _ struct{}) (*sdk.CallToolResult, tagsOut, error) {
	tc, err := t.svc.Tags(t.userID)
	if err != nil {
		return nil, tagsOut{}, domainErr(err, "")
	}
	var b strings.Builder
	for _, c := range tc {
		fmt.Fprintf(&b, "- #%s (%d)\n", c.Tag, c.Count)
	}
	if len(tc) == 0 {
		return textResult("Nenhuma tag em uso."), tagsOut{Tags: tc}, nil
	}
	return textResult("%d tag(s):\n%s", len(tc), b.String()), tagsOut{Tags: tc}, nil
}

// --- escrita ---

type createIn struct {
	Title string   `json:"title" jsonschema:"título curto e único"`
	Body  string   `json:"body,omitempty" jsonschema:"corpo em Markdown"`
	Tags  []string `json:"tags,omitempty" jsonschema:"tags (kebab-case)"`
}

type writeOut struct {
	ID    string   `json:"id"`
	Title string   `json:"title"`
	Tags  []string `json:"tags"`
}

func (t *tools) create(ctx context.Context, _ *sdk.CallToolRequest, in createIn) (*sdk.CallToolResult, writeOut, error) {
	title := strings.TrimSpace(in.Title)
	if title == "" {
		return nil, writeOut{}, errors.New("title é obrigatório")
	}
	if ex, err := t.svc.GetByTitle(t.userID, title); err == nil {
		return nil, writeOut{}, fmt.Errorf("já existe o zettel «%s» (id %s); edite-o com edit_zettel ou escolha outro título", ex.Title, ex.ID)
	} else if !errors.Is(err, zettel.ErrNotFound) {
		return nil, writeOut{}, domainErr(err, "")
	}
	tags := []string{}
	for _, tg := range in.Tags {
		if n := zettel.NormalizeTag(tg); n != "" && !contains(tags, n) {
			tags = append(tags, n)
		}
	}
	z, err := t.svc.Create(agentCtx(ctx), t.userID, zettel.CreateInput{Title: title, Body: in.Body, Tags: tags})
	if err != nil {
		return nil, writeOut{}, domainErr(err, "")
	}
	return textResult("Criado «%s» (id %s, %s).", z.Title, z.ID, tagsText(z.Tags)), writeOut{ID: z.ID, Title: z.Title, Tags: z.Tags}, nil
}

func contains(xs []string, x string) bool {
	for _, v := range xs {
		if v == x {
			return true
		}
	}
	return false
}

type editIn struct {
	ID        string  `json:"id" jsonschema:"id do zettel"`
	OldString string  `json:"old_string,omitempty" jsonschema:"trecho exato a trocar (precisa aparecer uma vez)"`
	NewString string  `json:"new_string,omitempty" jsonschema:"texto novo no lugar do trecho (vazio apaga)"`
	Body      *string `json:"body,omitempty" jsonschema:"corpo inteiro novo (em vez de old_string/new_string)"`
}

func (t *tools) edit(ctx context.Context, _ *sdk.CallToolRequest, in editIn) (*sdk.CallToolResult, writeOut, error) {
	patch := in.OldString != ""
	whole := in.Body != nil
	if patch == whole {
		return nil, writeOut{}, errors.New("informe old_string/new_string (trecho) ou body (corpo inteiro), um modo só")
	}
	var (
		z   *models.Zettel
		err error
	)
	if patch {
		z, err = t.svc.Patch(agentCtx(ctx), t.userID, in.ID, in.OldString, in.NewString)
	} else {
		cur, gerr := t.svc.Get(t.userID, in.ID)
		if gerr != nil {
			return nil, writeOut{}, domainErr(gerr, in.ID)
		}
		at := time.Now().UnixMilli()
		if at <= cur.UpdatedAt {
			at = cur.UpdatedAt + 1
		}
		z, err = t.svc.Update(agentCtx(ctx), t.userID, in.ID, zettel.UpdateInput{
			Title: cur.Title, Body: *in.Body, Tags: cur.Tags, UpdatedAt: at,
		})
	}
	if err != nil {
		return nil, writeOut{}, domainErr(err, in.ID)
	}
	mode := "trecho trocado"
	if whole {
		mode = "corpo substituído"
	}
	return textResult("Editado «%s» (id %s): %s.", z.Title, z.ID, mode), writeOut{ID: z.ID, Title: z.Title, Tags: z.Tags}, nil
}

type setTagsIn struct {
	ID     string   `json:"id" jsonschema:"id do zettel"`
	Add    []string `json:"add,omitempty" jsonschema:"tags a acrescentar"`
	Remove []string `json:"remove,omitempty" jsonschema:"tags a remover"`
}

func (t *tools) setTags(ctx context.Context, _ *sdk.CallToolRequest, in setTagsIn) (*sdk.CallToolResult, writeOut, error) {
	z, err := t.svc.SetTags(agentCtx(ctx), t.userID, in.ID, in.Add, in.Remove)
	if err != nil {
		return nil, writeOut{}, domainErr(err, in.ID)
	}
	return textResult("Tags de «%s»: %s.", z.Title, tagsText(z.Tags)), writeOut{ID: z.ID, Title: z.Title, Tags: z.Tags}, nil
}

type renameIn struct {
	ID       string `json:"id" jsonschema:"id do zettel"`
	NewTitle string `json:"new_title" jsonschema:"título novo"`
}

type renameOut struct {
	ID             string   `json:"id"`
	Title          string   `json:"title"`
	RewrittenCount int      `json:"rewritten_count"`
	Rewritten      []string `json:"rewritten"`
}

func (t *tools) rename(ctx context.Context, _ *sdk.CallToolRequest, in renameIn) (*sdk.CallToolResult, renameOut, error) {
	z, ids, err := t.svc.Rename(agentCtx(ctx), t.userID, in.ID, in.NewTitle)
	if err != nil {
		return nil, renameOut{}, domainErr(err, in.ID)
	}
	titles := []string{}
	for _, id := range ids {
		if r, err := t.svc.Get(t.userID, id); err == nil {
			titles = append(titles, r.Title)
		}
	}
	out := renameOut{ID: z.ID, Title: z.Title, RewrittenCount: len(ids), Rewritten: titles}
	if len(ids) == 0 {
		return textResult("Renomeado para «%s»; nenhum outro zettel citava o título antigo.", z.Title), out, nil
	}
	return textResult("Renomeado para «%s»; links reescritos em %d zettel(s): %s.", z.Title, len(ids), quoteAll(titles)), out, nil
}

func quoteAll(ts []string) string {
	q := make([]string, len(ts))
	for i, t := range ts {
		q[i] = "«" + t + "»"
	}
	return strings.Join(q, ", ")
}

type deleteIn struct {
	ID string `json:"id" jsonschema:"id do zettel"`
}

type deleteOut struct {
	ID      string   `json:"id"`
	Title   string   `json:"title"`
	CitedBy []string `json:"cited_by"`
}

func (t *tools) delete(ctx context.Context, _ *sdk.CallToolRequest, in deleteIn) (*sdk.CallToolResult, deleteOut, error) {
	z, err := t.svc.Get(t.userID, in.ID)
	if err != nil {
		return nil, deleteOut{}, domainErr(err, in.ID)
	}
	_, inc, err := t.svc.Links(t.userID, in.ID)
	if err != nil {
		return nil, deleteOut{}, domainErr(err, in.ID)
	}
	if err := t.svc.Delete(agentCtx(ctx), t.userID, in.ID); err != nil {
		return nil, deleteOut{}, domainErr(err, in.ID)
	}
	cited := []string{}
	for _, r := range inc {
		if r.ID != in.ID {
			cited = append(cited, r.Title)
		}
	}
	out := deleteOut{ID: z.ID, Title: z.Title, CitedBy: cited}
	if len(cited) == 0 {
		return textResult("Apagado «%s». Nenhum zettel o citava.", z.Title), out, nil
	}
	return textResult("Apagado «%s». Estes zettels o citavam e ficaram com o link sem destino: %s.", z.Title, quoteAll(cited)), out, nil
}

// --- desenhos ---

type drawingIn struct {
	ID string `json:"id" jsonschema:"id do desenho (o que vem depois de zk:draw/)"`
}

type drawingOut struct {
	ID        string   `json:"id"`
	Type      string   `json:"type"`
	Strokes   int      `json:"strokes"`
	Colors    []string `json:"colors"`
	BBox      []int    `json:"bbox"`
	UpdatedAt string   `json:"updated_at"`
	SVG       string   `json:"svg"`
}

func (t *tools) readDrawing(_ context.Context, _ *sdk.CallToolRequest, in drawingIn) (*sdk.CallToolResult, drawingOut, error) {
	d, err := t.drawings.Repo().Get(t.userID, in.ID)
	if err != nil {
		return nil, drawingOut{}, fmt.Errorf("falha interna: %v", err)
	}
	if d == nil {
		return nil, drawingOut{}, fmt.Errorf("desenho não encontrado: %s", in.ID)
	}
	out := summarizeScene(d.Scene)
	out.ID, out.UpdatedAt, out.SVG = d.ID, fmtTime(d.UpdatedAt), d.SVG
	return textResult("Desenho %s: cena %s, %d traço(s), cores %s, área %v (minX, minY, maxX, maxY). SVG de preview com %d bytes em structuredContent.svg.",
		d.ID, out.Type, out.Strokes, strings.Join(out.Colors, " "), out.BBox, len(d.SVG)), out, nil
}

func summarizeScene(scene string) drawingOut {
	var sc struct {
		Type    string `json:"type"`
		Strokes []struct {
			Color  string      `json:"color"`
			Points [][]float64 `json:"points"`
		} `json:"strokes"`
	}
	out := drawingOut{Colors: []string{}, BBox: []int{}}
	if err := json.Unmarshal([]byte(scene), &sc); err != nil {
		out.Type = "desconhecido"
		return out
	}
	out.Type, out.Strokes = sc.Type, len(sc.Strokes)
	seen := map[string]bool{}
	first := true
	var minX, minY, maxX, maxY float64
	for _, s := range sc.Strokes {
		if s.Color != "" && !seen[s.Color] {
			seen[s.Color] = true
			out.Colors = append(out.Colors, s.Color)
		}
		for _, p := range s.Points {
			if len(p) < 2 {
				continue
			}
			if first {
				minX, maxX, minY, maxY, first = p[0], p[0], p[1], p[1], false
				continue
			}
			minX, maxX = min(minX, p[0]), max(maxX, p[0])
			minY, maxY = min(minY, p[1]), max(maxY, p[1])
		}
	}
	sort.Strings(out.Colors)
	if !first {
		out.BBox = []int{int(minX), int(minY), int(maxX), int(maxY)}
	}
	return out
}

type writeDrawingIn struct {
	ID     string `json:"id,omitempty" jsonschema:"id de um desenho existente; vazio cria um novo"`
	Scene  string `json:"scene" jsonschema:"JSON da cena zk-sketch v1, como string"`
	SVG    string `json:"svg" jsonschema:"SVG de preview"`
	Width  int    `json:"width,omitempty" jsonschema:"largura do SVG em px"`
	Height int    `json:"height,omitempty" jsonschema:"altura do SVG em px"`
}

type writeDrawingOut struct {
	ID     string `json:"id"`
	Status string `json:"status"`
	Ref    string `json:"ref"`
}

func (t *tools) writeDrawing(ctx context.Context, _ *sdk.CallToolRequest, in writeDrawingIn) (*sdk.CallToolResult, writeDrawingOut, error) {
	id := in.ID
	now := time.Now().UnixMilli()
	created, updated := now, now
	if id == "" {
		id = zettel.NewID()
	} else {
		if !drawings.ValidID(id) {
			return nil, writeDrawingOut{}, fmt.Errorf("id de desenho inválido: %q (alfanumérico, até 64)", id)
		}
		prev, err := t.drawings.Repo().Get(t.userID, id)
		if err != nil {
			return nil, writeDrawingOut{}, fmt.Errorf("falha interna: %v", err)
		}
		if prev != nil {
			created = prev.CreatedAt
			if updated <= prev.UpdatedAt {
				updated = prev.UpdatedAt + 1
			}
		}
	}
	status, err := t.drawings.Store(agentCtx(ctx), t.userID, id, drawings.StoreInput{
		Scene: in.Scene, SVG: in.SVG, Width: in.Width, Height: in.Height, CreatedAt: created, UpdatedAt: updated,
	})
	if err != nil {
		var se *drawings.StoreError
		if errors.As(err, &se) {
			return nil, writeDrawingOut{}, fmt.Errorf("desenho recusado: %s", se.Msg)
		}
		return nil, writeDrawingOut{}, fmt.Errorf("falha interna: %v", err)
	}
	ref := "![](zk:draw/" + id + ")"
	return textResult("Desenho %s gravado (%s). Para aparecer num zettel, o corpo precisa conter %s.", id, status, ref),
		writeDrawingOut{ID: id, Status: status, Ref: ref}, nil
}
