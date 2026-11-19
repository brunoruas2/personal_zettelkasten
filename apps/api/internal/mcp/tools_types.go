package mcp

import (
	"context"
	"errors"
	"fmt"
	"sort"
	"strings"

	"github.com/brunofullstack/zettelkasten/api/internal/models"
	"github.com/brunofullstack/zettelkasten/api/internal/types"
	"github.com/brunofullstack/zettelkasten/api/internal/zettel"
	sdk "github.com/modelcontextprotocol/go-sdk/mcp"
)

// Tipos de zettel pelo MCP: só leitura dos tipos e atribuição a zettels. O
// agente nunca cria, edita nem apaga a definição de um tipo (seria possível
// tirar uma seção protegida); isso é do usuário, pelo app.

type levelOut struct {
	Key      string `json:"key"`
	Label    string `json:"label"`
	Emoji    string `json:"emoji,omitempty"`
	UserOnly bool   `json:"user_only"`
}

type typeOut struct {
	ID                string     `json:"id"`
	Name              string     `json:"name"`
	Slug              string     `json:"slug"`
	Icon              string     `json:"icon"`
	CountsProgress    bool       `json:"counts_progress"`
	ProtectedSections []string   `json:"protected_sections"`
	Levels            []levelOut `json:"levels"`
}

type typesOut struct {
	Types []typeOut `json:"types"`
}

func toTypeOut(t types.Type) typeOut {
	o := typeOut{
		ID: t.ID, Name: t.Name, Slug: t.Slug, Icon: t.Icon, CountsProgress: t.CountsProgress,
		ProtectedSections: t.ProtectedSections, Levels: make([]levelOut, len(t.Levels)),
	}
	if o.ProtectedSections == nil {
		o.ProtectedSections = []string{}
	}
	for i, l := range t.Levels {
		o.Levels[i] = levelOut{Key: l.Key, Label: l.Label, Emoji: l.Emoji, UserOnly: l.UserOnly}
	}
	return o
}

func (t *tools) listTypes(_ context.Context, _ *sdk.CallToolRequest, _ struct{}) (*sdk.CallToolResult, typesOut, error) {
	repo := t.svc.Types()
	if repo == nil {
		return textResult("Tipos de zettel não estão disponíveis."), typesOut{Types: []typeOut{}}, nil
	}
	list, err := repo.List(t.userID)
	if err != nil {
		return nil, typesOut{}, domainErr(err, "")
	}
	out := typesOut{Types: make([]typeOut, len(list))}
	var b strings.Builder
	for i, tp := range list {
		out.Types[i] = toTypeOut(tp)
		fmt.Fprintf(&b, "- %s %s (slug %s%s)", tp.Icon, tp.Name, tp.Slug, progressNote(tp))
		if len(tp.ProtectedSections) > 0 {
			fmt.Fprintf(&b, "; seções só do usuário: %s", strings.Join(tp.ProtectedSections, ", "))
		}
		if len(tp.Levels) > 0 {
			parts := make([]string, len(tp.Levels))
			for j, l := range tp.Levels {
				parts[j] = strings.TrimSpace(l.Emoji+" "+l.Key) + reservedNote(l)
			}
			fmt.Fprintf(&b, "; níveis: %s", strings.Join(parts, " → "))
		}
		b.WriteString("\n")
	}
	if len(list) == 0 {
		return textResult("Nenhum tipo cadastrado. Só o usuário cria tipos, no app (Configurações → Tipos)."), out, nil
	}
	return textResult("%d tipo(s):\n%s", len(list), b.String()), out, nil
}

func progressNote(t types.Type) string {
	if t.CountsProgress {
		return ", conta no progresso das trilhas"
	}
	return ""
}

func reservedNote(l types.Level) string {
	if l.UserOnly {
		return " (só o usuário)"
	}
	return ""
}

type setTypeIn struct {
	ID    string `json:"id" jsonschema:"id do zettel"`
	Type  string `json:"type,omitempty" jsonschema:"slug ou id do tipo (ver list_types); vazio remove o tipo"`
	Level string `json:"level,omitempty" jsonschema:"chave do nível; vazio = limpa na troca de tipo, mantém no mesmo tipo"`
}

type setTypeOut struct {
	ID    string `json:"id"`
	Title string `json:"title"`
	Type  string `json:"type,omitempty"`
	Level string `json:"level,omitempty"`
}

func (t *tools) setType(ctx context.Context, _ *sdk.CallToolRequest, in setTypeIn) (*sdk.CallToolResult, setTypeOut, error) {
	info, err := t.svc.SetType(agentCtx(ctx), t.userID, in.ID, in.Type, in.Level)
	if err != nil {
		return nil, setTypeOut{}, domainErr(err, in.ID)
	}
	z, err := t.svc.Get(t.userID, in.ID)
	if err != nil {
		return nil, setTypeOut{}, domainErr(err, in.ID)
	}
	out := setTypeOut{ID: z.ID, Title: z.Title}
	if info.Type == nil {
		return textResult("«%s» ficou sem tipo.", z.Title), out, nil
	}
	out.Type, out.Level = info.Type.Slug, info.Level
	return textResult("«%s» agora é %s.", z.Title, typeLabel(out.Type, out.Level)), out, nil
}

type trailIn struct {
	ID    string `json:"id,omitempty" jsonschema:"id da trilha"`
	Title string `json:"title,omitempty" jsonschema:"título exato da trilha, se não souber o id"`
}

type progressCount struct {
	Key   string `json:"key"` // chave do nível, ou "tipo:nível" com vários tipos; "" = sem nível
	Label string `json:"label"`
	Emoji string `json:"emoji,omitempty"`
	Count int    `json:"count"`
}

type progressItem struct {
	ID    string `json:"id"`
	Title string `json:"title"`
	Type  string `json:"type"`
	Level string `json:"level,omitempty"`
}

type progressOut struct {
	ID     string          `json:"id"`
	Title  string          `json:"title"`
	Total  int             `json:"total"`
	Counts []progressCount `json:"counts"`
	Items  []progressItem  `json:"items"`
}

func (t *tools) trailProgress(_ context.Context, _ *sdk.CallToolRequest, in trailIn) (*sdk.CallToolResult, progressOut, error) {
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
			return nil, progressOut{}, fmt.Errorf("nenhum zettel com o título %q; use search_zettels", in.Title)
		}
	default:
		return nil, progressOut{}, errors.New("informe id ou title")
	}
	if err != nil {
		return nil, progressOut{}, domainErr(err, in.ID)
	}
	outRefs, _, err := t.svc.Links(t.userID, z.ID)
	if err != nil {
		return nil, progressOut{}, domainErr(err, z.ID)
	}

	// Só os links de saída comuns (o link de pai [[^título]] aponta para o pai
	// da própria trilha), na ordem em que aparecem no corpo.
	refs := make([]zettel.LinkRef, 0, len(outRefs))
	for _, r := range outRefs {
		if !r.Parent {
			refs = append(refs, r)
		}
	}
	lower := strings.ToLower(z.Body)
	at := func(r zettel.LinkRef) int {
		if i := strings.Index(lower, "[["+strings.ToLower(r.Title)); i >= 0 {
			return i
		}
		return len(lower) + 1
	}
	sort.SliceStable(refs, func(i, j int) bool { return at(refs[i]) < at(refs[j]) })

	ids := make([]string, len(refs))
	for i, r := range refs {
		ids[i] = r.ID
	}
	infos, err := t.svc.TypesOf(t.userID, ids)
	if err != nil {
		return nil, progressOut{}, domainErr(err, z.ID)
	}

	out := progressOut{ID: z.ID, Title: z.Title, Counts: []progressCount{}, Items: []progressItem{}}
	var order []*types.Type // tipos que contam, na ordem em que aparecem
	seen := map[string]bool{}
	counts := map[string]int{} // "tipo:nível" → quantidade
	for _, r := range refs {
		info, ok := infos[r.ID]
		if !ok || info.Type == nil || !info.Type.CountsProgress {
			continue
		}
		if !seen[info.Type.ID] {
			seen[info.Type.ID] = true
			order = append(order, info.Type)
		}
		counts[info.Type.ID+"\x00"+info.Level]++
		out.Items = append(out.Items, progressItem{ID: r.ID, Title: r.Title, Type: info.Type.Slug, Level: info.Level})
	}
	out.Total = len(out.Items)

	// Com um tipo só, a chave é o próprio nível; com vários, "tipo:nível".
	for _, tp := range order {
		key := func(level string) string {
			if len(order) == 1 {
				return level
			}
			return tp.Slug + ":" + level
		}
		for _, l := range tp.Levels {
			out.Counts = append(out.Counts, progressCount{
				Key: key(l.Key), Label: l.Label, Emoji: l.Emoji, Count: counts[tp.ID+"\x00"+l.Key],
			})
		}
		if n := counts[tp.ID+"\x00"]; n > 0 {
			out.Counts = append(out.Counts, progressCount{Key: key(""), Label: "sem nível", Count: n})
		}
	}

	var b strings.Builder
	if out.Total == 0 {
		return textResult("Trilha «%s»: nenhum conteúdo (tipo que conta no progresso) citado.", z.Title), out, nil
	}
	parts := make([]string, len(out.Counts))
	for i, c := range out.Counts {
		parts[i] = fmt.Sprintf("%s %d", strings.TrimSpace(c.Emoji+" "+c.Label), c.Count)
	}
	fmt.Fprintf(&b, "Trilha «%s»: %d conteúdo(s) — %s.\n", z.Title, out.Total, strings.Join(parts, ", "))
	for _, it := range out.Items {
		fmt.Fprintf(&b, "- %s (%s)\n", it.Title, typeLabel(it.Type, it.Level))
	}
	return textResult("%s", strings.TrimRight(b.String(), "\n")), out, nil
}
