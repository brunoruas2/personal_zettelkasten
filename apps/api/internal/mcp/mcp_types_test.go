package mcp_test

import (
	"context"
	"strings"
	"testing"

	"github.com/brunofullstack/zettelkasten/api/internal/types"
	"github.com/brunofullstack/zettelkasten/api/internal/zettel"
)

const mcpTemplate = "## Captura\n\n## Minha síntese\n\n## Testes\n"

// seedTypes cadastra Conteúdo (conta no progresso, síntese protegida, 3 níveis,
// o último só do usuário), Fonte e Teste (sem níveis, não contam).
func (e *env) seedTypes(t *testing.T) {
	t.Helper()
	_, err := e.trepo.Upsert(e.userA, []types.Type{
		{
			ID: "tc", Name: "Conteúdo", Slug: "conteudo", Icon: "📘", Color: "#a78bfa", Template: mcpTemplate,
			ProtectedSections: []string{"Minha síntese"}, CountsProgress: true, UpdatedAt: 1,
			Levels: []types.Level{
				{Key: "semente", Label: "Semente", Emoji: "🤖"},
				{Key: "testado", Label: "Testado", Emoji: "💾"},
				{Key: "consolidado", Label: "Consolidado", Emoji: "🧠", UserOnly: true},
			},
		},
		{ID: "tf", Name: "Fonte", Slug: "fonte", Icon: "📚", Color: "#60a5fa", UpdatedAt: 1},
		{ID: "tt", Name: "Teste", Slug: "teste", Icon: "🧪", Color: "#4ade80", UpdatedAt: 1},
	}, 10)
	if err != nil {
		t.Fatal(err)
	}
}

// typed cria um zettel já atribuído (como o usuário, pelo serviço).
func (e *env) typed(t *testing.T, title, typ, level, body string) string {
	t.Helper()
	z, err := e.svc.Create(context.Background(), e.userA, zettel.CreateInput{Title: title, Body: body, Type: typ, Level: level})
	if err != nil {
		t.Fatal(err)
	}
	return z.ID
}

func TestInstructionsCabemEmDoisKB(t *testing.T) {
	e := newEnv(t, nil)
	cs := e.connect(t, e.keyA)
	if n := len(cs.InitializeResult().Instructions); n > 2048 {
		t.Fatalf("instructions com %d bytes (limite 2048)", n)
	}
}

func TestListTypes(t *testing.T) {
	e := newEnv(t, nil)
	cs := e.connect(t, e.keyA)

	res, text := call(t, cs, "list_types", nil)
	if res.IsError || !strings.Contains(text, "Nenhum tipo") {
		t.Fatalf("sem tipos: %v %s", res.IsError, text)
	}

	e.seedTypes(t)
	res, text = call(t, cs, "list_types", nil)
	var out struct {
		Types []struct {
			Slug              string   `json:"slug"`
			CountsProgress    bool     `json:"counts_progress"`
			ProtectedSections []string `json:"protected_sections"`
			Levels            []struct {
				Key      string `json:"key"`
				UserOnly bool   `json:"user_only"`
			} `json:"levels"`
		} `json:"types"`
	}
	structured(t, res, &out)
	if len(out.Types) != 3 {
		t.Fatalf("esperava 3 tipos: %s", text)
	}
	var c = out.Types[0]
	for _, x := range out.Types {
		if x.Slug == "conteudo" {
			c = x
		}
	}
	if c.Slug != "conteudo" || !c.CountsProgress || len(c.Levels) != 3 || !c.Levels[2].UserOnly || c.ProtectedSections[0] != "Minha síntese" {
		t.Fatalf("conteudo: %+v", c)
	}
	if strings.Contains(text, "## Captura") {
		t.Fatal("list_types não deve expor o template")
	}
	if !strings.Contains(text, "só o usuário") {
		t.Fatalf("o texto devia avisar o nível reservado: %s", text)
	}
}

func TestCreateWithTypeAppliesTemplate(t *testing.T) {
	e := newEnv(t, nil)
	e.seedTypes(t)
	cs := e.connect(t, e.keyA)

	res, text := call(t, cs, "create_zettel", map[string]any{"title": "Índices", "type": "conteudo"})
	if res.IsError {
		t.Fatalf("create: %s", text)
	}
	z, err := e.svc.GetByTitle(e.userA, "Índices")
	if err != nil || z.Body != mcpTemplate {
		t.Fatalf("corpo = %q (%v)", z.Body, err)
	}
	if info, _ := e.svc.TypeOf(e.userA, z.ID); info.Type == nil || info.Type.Slug != "conteudo" {
		t.Fatalf("tipo não atribuído: %+v", info)
	}

	// Tipo desconhecido: erro que lista os slugs.
	res, text = call(t, cs, "create_zettel", map[string]any{"title": "X", "type": "xyz"})
	if !res.IsError || !strings.Contains(text, "conteudo") {
		t.Fatalf("tipo desconhecido: %v %s", res.IsError, text)
	}
	// Síntese preenchida na criação é recusada e nada é criado.
	res, text = call(t, cs, "create_zettel", map[string]any{"title": "Y", "type": "conteudo", "body": "## Minha síntese\nfeito pelo agente"})
	if !res.IsError || !strings.Contains(text, "recusado") {
		t.Fatalf("síntese na criação: %v %s", res.IsError, text)
	}
	if _, err := e.svc.GetByTitle(e.userA, "Y"); err == nil {
		t.Fatal("o zettel não devia ter sido criado")
	}
}

func TestSetTypeLevelsAndReservedLevel(t *testing.T) {
	e := newEnv(t, nil)
	e.seedTypes(t)
	id := e.mk(t, "Recursão", "corpo")
	cs := e.connect(t, e.keyA)

	res, text := call(t, cs, "set_type", map[string]any{"id": id, "type": "conteudo", "level": "semente"})
	if res.IsError || !strings.Contains(text, "conteudo/semente") {
		t.Fatalf("set_type: %v %s", res.IsError, text)
	}
	if res, text = call(t, cs, "set_type", map[string]any{"id": id, "type": "conteudo", "level": "testado"}); res.IsError {
		t.Fatalf("testado: %s", text)
	}
	// Nível inexistente: isError com os válidos.
	res, text = call(t, cs, "set_type", map[string]any{"id": id, "type": "conteudo", "level": "publicado"})
	if !res.IsError || !strings.Contains(text, "semente") {
		t.Fatalf("nível inexistente: %v %s", res.IsError, text)
	}
	// Nível reservado ao usuário.
	res, text = call(t, cs, "set_type", map[string]any{"id": id, "type": "conteudo", "level": "consolidado"})
	if !res.IsError || !strings.Contains(text, "reservado ao usuário") {
		t.Fatalf("reservado: %v %s", res.IsError, text)
	}
	if info, _ := e.svc.TypeOf(e.userA, id); info.Level != "testado" {
		t.Fatalf("o nível não devia mudar: %+v", info)
	}
	// Remover o tipo.
	if res, text = call(t, cs, "set_type", map[string]any{"id": id}); res.IsError || !strings.Contains(text, "sem tipo") {
		t.Fatalf("remover: %v %s", res.IsError, text)
	}
}

func TestEditProtectedSectionIsRefused(t *testing.T) {
	e := newEnv(t, nil)
	e.seedTypes(t)
	id := e.typed(t, "Recursão", "conteudo", "semente", "## Captura\nx\n\n## Minha síntese\n- minha\n")
	cs := e.connect(t, e.keyA)

	res, text := call(t, cs, "edit_zettel", map[string]any{"id": id, "old_string": "- minha", "new_string": "- do agente"})
	if !res.IsError || !strings.Contains(text, "Minha síntese") || !strings.Contains(text, "recusado") {
		t.Fatalf("síntese: %v %s", res.IsError, text)
	}
	if z, _ := e.svc.Get(e.userA, id); !strings.Contains(z.Body, "- minha") {
		t.Fatal("a síntese foi alterada")
	}
	if res, text = call(t, cs, "edit_zettel", map[string]any{"id": id, "old_string": "x", "new_string": "captura nova"}); res.IsError {
		t.Fatalf("Captura devia passar: %s", text)
	}
}

func TestSearchAndRecentFilterByTypeAndLevel(t *testing.T) {
	e := newEnv(t, nil)
	e.seedTypes(t)
	a := e.typed(t, "JOIN", "conteudo", "semente", "recursão e join")
	e.typed(t, "Índice", "conteudo", "testado", "recursão em índice")
	e.typed(t, "Livro", "fonte", "", "recursão no livro")
	e.mk(t, "Livre", "recursão solta")
	cs := e.connect(t, e.keyA)

	list := func(name string, args map[string]any) []struct {
		ID, Title, Type, Level string
	} {
		res, text := call(t, cs, name, args)
		if res.IsError {
			t.Fatalf("%s %v: %s", name, args, text)
		}
		var out struct {
			Results []struct {
				ID    string `json:"id"`
				Title string `json:"title"`
				Type  string `json:"type"`
				Level string `json:"level"`
			} `json:"results"`
		}
		structured(t, res, &out)
		r := make([]struct{ ID, Title, Type, Level string }, len(out.Results))
		for i, x := range out.Results {
			r[i] = struct{ ID, Title, Type, Level string }{x.ID, x.Title, x.Type, x.Level}
		}
		return r
	}

	if got := list("search_zettels", map[string]any{"query": "recursão"}); len(got) != 4 {
		t.Fatalf("sem filtro: %d", len(got))
	}
	got := list("search_zettels", map[string]any{"query": "recursão", "type": "conteudo"})
	if len(got) != 2 || got[0].Type != "conteudo" {
		t.Fatalf("type=conteudo: %+v", got)
	}
	got = list("search_zettels", map[string]any{"query": "", "type": "conteudo", "level": "testado"})
	if len(got) != 1 || got[0].Title != "Índice" || got[0].Level != "testado" {
		t.Fatalf("texto vazio + tipo + nível: %+v", got)
	}
	got = list("list_recent", map[string]any{"type": "fonte"})
	if len(got) != 1 || got[0].Title != "Livro" {
		t.Fatalf("list_recent type=fonte: %+v", got)
	}
	if got = list("list_recent", map[string]any{"level": "semente"}); len(got) != 1 || got[0].ID != a {
		t.Fatalf("list_recent level=semente: %+v", got)
	}
	// Tipo desconhecido: isError.
	if res, text := call(t, cs, "search_zettels", map[string]any{"query": "x", "type": "nada"}); !res.IsError || !strings.Contains(text, "conteudo") {
		t.Fatalf("tipo desconhecido: %v %s", res.IsError, text)
	}
	// read_zettel traz tipo e nível.
	res, text := call(t, cs, "read_zettel", map[string]any{"id": a})
	var full struct{ Type, Level string }
	structured(t, res, &full)
	if full.Type != "conteudo" || full.Level != "semente" || !strings.Contains(text, "tipo conteudo/semente") {
		t.Fatalf("read_zettel: %+v %s", full, text)
	}
}

func TestTrailProgress(t *testing.T) {
	e := newEnv(t, nil)
	e.seedTypes(t)
	e.typed(t, "Índices", "conteudo", "semente", "x")
	e.typed(t, "JOIN", "conteudo", "testado", "x")
	e.typed(t, "Normalização", "conteudo", "semente", "x")
	e.typed(t, "SQL Antipatterns", "fonte", "", "x")
	e.typed(t, "Teste — SQL", "teste", "", "x")
	e.mk(t, "Sem tipo", "x")
	e.mk(t, "Curso", "x") // será o pai da trilha
	// Ordem do corpo: JOIN, Índices, Normalização; o resto não conta.
	trail := e.typed(t, "Estudar SQL", "", "", "[[^Curso]]\n[[JOIN]] depois [[Índices]] e [[SQL Antipatterns]], [[Teste — SQL]], [[Sem tipo]], [[Normalização]]")
	cs := e.connect(t, e.keyA)

	res, text := call(t, cs, "trail_progress", map[string]any{"id": trail})
	if res.IsError {
		t.Fatalf("trail_progress: %s", text)
	}
	var out struct {
		Total  int `json:"total"`
		Counts []struct {
			Key   string `json:"key"`
			Count int    `json:"count"`
		} `json:"counts"`
		Items []struct {
			Title string `json:"title"`
			Type  string `json:"type"`
			Level string `json:"level"`
		} `json:"items"`
	}
	structured(t, res, &out)
	if out.Total != 3 {
		t.Fatalf("total = %d, queria 3: %s", out.Total, text)
	}
	// Escada na ordem, com zero no nível sem zettels.
	want := []struct {
		key string
		n   int
	}{{"semente", 2}, {"testado", 1}, {"consolidado", 0}}
	if len(out.Counts) != len(want) {
		t.Fatalf("counts: %+v", out.Counts)
	}
	for i, w := range want {
		if out.Counts[i].Key != w.key || out.Counts[i].Count != w.n {
			t.Fatalf("counts[%d] = %+v, queria %v", i, out.Counts[i], w)
		}
	}
	// Ordem do corpo; Teste, Fonte, sem tipo e o link de pai ficam fora.
	titles := []string{}
	for _, it := range out.Items {
		titles = append(titles, it.Title)
		if it.Type != "conteudo" {
			t.Fatalf("só conteúdo conta: %+v", it)
		}
	}
	if strings.Join(titles, "|") != "JOIN|Índices|Normalização" {
		t.Fatalf("ordem: %v", titles)
	}

	// Por título.
	if res, text = call(t, cs, "trail_progress", map[string]any{"title": "estudar sql"}); res.IsError {
		t.Fatalf("por título: %s", text)
	}
	// Trilha sem conteúdo.
	empty := e.mk(t, "Vazia", "só [[Sem tipo]]")
	res, text = call(t, cs, "trail_progress", map[string]any{"id": empty})
	structured(t, res, &out)
	if res.IsError || out.Total != 0 || len(out.Items) != 0 || !strings.Contains(text, "nenhum conteúdo") {
		t.Fatalf("trilha sem conteúdo: %v %+v %s", res.IsError, out, text)
	}
	// Sem id nem título.
	if res, _ = call(t, cs, "trail_progress", map[string]any{}); !res.IsError {
		t.Fatal("sem id nem título devia ser erro")
	}
}

func TestTrailProgressComVariosTiposAgrupaPorTipoENivel(t *testing.T) {
	e := newEnv(t, nil)
	e.seedTypes(t)
	// Segundo tipo que também conta, com escada própria.
	if _, err := e.trepo.Upsert(e.userA, []types.Type{{
		ID: "tp", Name: "Prática", Slug: "pratica", Icon: "🛠️", Color: "#f87171", CountsProgress: true, UpdatedAt: 1,
		Levels: []types.Level{{Key: "feito", Label: "Feito"}},
	}}, 20); err != nil {
		t.Fatal(err)
	}
	e.typed(t, "A", "conteudo", "semente", "x")
	e.typed(t, "B", "pratica", "feito", "x")
	trail := e.mk(t, "Trilha mista", "[[A]] [[B]]")
	cs := e.connect(t, e.keyA)

	res, _ := call(t, cs, "trail_progress", map[string]any{"id": trail})
	var out struct {
		Counts []struct {
			Key   string `json:"key"`
			Count int    `json:"count"`
		} `json:"counts"`
	}
	structured(t, res, &out)
	keys := map[string]int{}
	for _, c := range out.Counts {
		keys[c.Key] = c.Count
	}
	if keys["conteudo:semente"] != 1 || keys["pratica:feito"] != 1 {
		t.Fatalf("chaves tipo:nível: %+v", out.Counts)
	}
}

func TestTypesIsolationBetweenUsers(t *testing.T) {
	e := newEnv(t, nil)
	e.seedTypes(t)
	id := e.mk(t, "Privado", "corpo")
	other := e.connect(t, e.keyB)

	if res, _ := call(t, other, "set_type", map[string]any{"id": id, "type": "conteudo"}); !res.IsError {
		t.Fatal("outro usuário não devia atribuir tipo a este zettel")
	}
	res, text := call(t, other, "list_types", nil)
	if res.IsError || !strings.Contains(text, "Nenhum tipo") {
		t.Fatalf("outro usuário viu os tipos: %s", text)
	}
	if res, _ := call(t, other, "trail_progress", map[string]any{"id": id}); !res.IsError {
		t.Fatal("trail_progress de zettel alheio devia ser erro")
	}
}

func TestNoToolEditsTypeDefinitions(t *testing.T) {
	e := newEnv(t, nil)
	cs := e.connect(t, e.keyA)
	lt, err := cs.ListTools(context.Background(), nil)
	if err != nil {
		t.Fatal(err)
	}
	for _, tl := range lt.Tools {
		n := tl.Name
		if strings.Contains(n, "type") && n != "list_types" && n != "set_type" {
			t.Fatalf("tool %q mexe na definição de tipos; só list_types e set_type são permitidas", n)
		}
	}
}
