package mcp_test

import (
	"strings"
	"testing"
)

func sessionArgs(extra map[string]any) map[string]any {
	a := map[string]any{
		"test":   "Teste — SQL",
		"date":   "2026-11-19",
		"result": "parcial",
		"questions": []map[string]any{
			{"technique": "recuperacao", "question": "O que é um JOIN?", "answer": "junta tabelas", "correct": true},
		},
	}
	for k, v := range extra {
		a[k] = v
	}
	return a
}

func TestLogTestSessionAppendsAndLinks(t *testing.T) {
	e := newEnv(t, nil)
	e.seedTypes(t)
	cs := e.connect(t, e.keyA)
	e.typed(t, "Teste — SQL", "teste", "", "## Sessões\n")
	e.typed(t, "JOIN", "conteudo", "semente", mcpTemplate)

	conf := 3
	res, text := call(t, cs, "log_test_session", sessionArgs(map[string]any{
		"confidence": conf,
		"concepts":   []string{"JOIN", "Inexistente"},
		"gaps":       []map[string]any{{"text": "tipos de JOIN"}, {"text": "ON vs WHERE", "closed": true}},
	}))
	if res.IsError {
		t.Fatalf("log: %s", text)
	}
	test, _ := e.svc.GetByTitle(e.userA, "Teste — SQL")
	for _, want := range []string{
		"### 2026-11-19 — parcial", "Confiança: 3/5", "Conteúdos: [[JOIN]]",
		"- [recuperacao] O que é um JOIN? → junta tabelas (acertou)", "- [ ] tipos de JOIN", "- [x] ON vs WHERE",
	} {
		if !strings.Contains(test.Body, want) {
			t.Fatalf("corpo do Teste sem %q:\n%s", want, test.Body)
		}
	}
	if !strings.Contains(text, "Inexistente") {
		t.Fatalf("omitido não listado: %s", text)
	}
	join, _ := e.svc.GetByTitle(e.userA, "JOIN")
	if !strings.Contains(join.Body, "## Testes\n\n- [[Teste — SQL]]") {
		t.Fatalf("link de volta ausente:\n%s", join.Body)
	}
	if info, _ := e.svc.TypeOf(e.userA, join.ID); info.Level != "semente" {
		t.Fatalf("nível mudou: %q", info.Level)
	}

	// Segunda sessão acumula; link de volta não duplica.
	res, text = call(t, cs, "log_test_session", sessionArgs(map[string]any{"date": "2026-11-20", "result": "passou", "concepts": []string{"JOIN"}}))
	if res.IsError {
		t.Fatalf("log 2: %s", text)
	}
	test, _ = e.svc.GetByTitle(e.userA, "Teste — SQL")
	if !strings.Contains(test.Body, "### 2026-11-19 — parcial") || !strings.Contains(test.Body, "### 2026-11-20 — passou") {
		t.Fatalf("sessões não acumularam:\n%s", test.Body)
	}
	join, _ = e.svc.GetByTitle(e.userA, "JOIN")
	if strings.Count(join.Body, "[[Teste — SQL]]") != 1 {
		t.Fatalf("link duplicado:\n%s", join.Body)
	}
}

func TestLogTestSessionCreatesSectionAndKeepsSynthesis(t *testing.T) {
	e := newEnv(t, nil)
	e.seedTypes(t)
	cs := e.connect(t, e.keyA)
	e.typed(t, "Teste — Redes", "teste", "", "texto do usuário")
	e.typed(t, "TCP", "conteudo", "semente", "## Captura\n\nx\n\n## Minha síntese\n\nminha ideia\n\n## Testes\n")

	res, text := call(t, cs, "log_test_session", sessionArgs(map[string]any{"test": "Teste — Redes", "concepts": []string{"TCP"}}))
	if res.IsError {
		t.Fatalf("log: %s", text)
	}
	test, _ := e.svc.GetByTitle(e.userA, "Teste — Redes")
	if !strings.HasPrefix(test.Body, "texto do usuário\n\n## Sessões\n\n### 2026-11-19") {
		t.Fatalf("seção não criada no fim:\n%s", test.Body)
	}
	tcp, _ := e.svc.GetByTitle(e.userA, "TCP")
	if !strings.Contains(tcp.Body, "## Minha síntese\n\nminha ideia\n") {
		t.Fatalf("síntese alterada:\n%s", tcp.Body)
	}
}

func TestLogTestSessionSkipsContentWithoutTestsSection(t *testing.T) {
	e := newEnv(t, nil)
	e.seedTypes(t)
	cs := e.connect(t, e.keyA)
	e.typed(t, "Teste — X", "teste", "", "")
	e.typed(t, "Sem seção", "conteudo", "semente", "só texto")

	res, text := call(t, cs, "log_test_session", sessionArgs(map[string]any{"test": "Teste — X", "concepts": []string{"Sem seção"}}))
	if res.IsError || !strings.Contains(text, "sem seção ## Testes") {
		t.Fatalf("esperava omitido sem erro: %v %s", res.IsError, text)
	}
	c, _ := e.svc.GetByTitle(e.userA, "Sem seção")
	if c.Body != "só texto" {
		t.Fatalf("conteúdo alterado: %q", c.Body)
	}
}

func TestLogTestSessionRejectsWrongTypeAndMissing(t *testing.T) {
	e := newEnv(t, nil)
	e.seedTypes(t)
	cs := e.connect(t, e.keyA)
	e.typed(t, "Um conteúdo", "conteudo", "semente", mcpTemplate)
	e.typed(t, "Sem tipo", "", "", "x")

	for _, ref := range []string{"Um conteúdo", "Sem tipo"} {
		res, text := call(t, cs, "log_test_session", sessionArgs(map[string]any{"test": ref}))
		if !res.IsError || !strings.Contains(text, "não é do tipo teste") {
			t.Fatalf("%s: %v %s", ref, res.IsError, text)
		}
	}
	res, text := call(t, cs, "log_test_session", sessionArgs(map[string]any{"test": "Não existe"}))
	if !res.IsError || !strings.Contains(text, "não encontrado") {
		t.Fatalf("inexistente: %v %s", res.IsError, text)
	}
}

func TestLogTestSessionValidatesInput(t *testing.T) {
	e := newEnv(t, nil)
	e.seedTypes(t)
	cs := e.connect(t, e.keyA)
	e.typed(t, "Teste — V", "teste", "", "")

	bad := []map[string]any{
		{"test": "Teste — V", "result": "ótimo"},
		{"test": "Teste — V", "confidence": 9},
		{"test": "Teste — V", "date": "ontem"},
		{"test": "Teste — V", "questions": []map[string]any{}},
		{"test": "Teste — V", "questions": []map[string]any{{"technique": "sorte", "question": "q", "correct": true}}},
	}
	for i, extra := range bad {
		res, text := call(t, cs, "log_test_session", sessionArgs(extra))
		if !res.IsError {
			t.Fatalf("caso %d devia falhar: %s", i, text)
		}
	}
	z, _ := e.svc.GetByTitle(e.userA, "Teste — V")
	if z.Body != "" {
		t.Fatalf("corpo gravado apesar do erro: %q", z.Body)
	}
}

func TestLogTestSessionNeutralizesHeadingsInText(t *testing.T) {
	e := newEnv(t, nil)
	e.seedTypes(t)
	cs := e.connect(t, e.keyA)
	e.typed(t, "Teste — H", "teste", "", "")
	res, text := call(t, cs, "log_test_session", sessionArgs(map[string]any{
		"test":      "Teste — H",
		"questions": []map[string]any{{"technique": "calibragem", "question": "a\n## Minha síntese\nb", "correct": false}},
	}))
	if res.IsError {
		t.Fatalf("log: %s", text)
	}
	z, _ := e.svc.GetByTitle(e.userA, "Teste — H")
	if strings.Contains(z.Body, "\n## Minha síntese") || !strings.Contains(z.Body, "(errou)") {
		t.Fatalf("texto virou cabeçalho:\n%s", z.Body)
	}
}
