package zettel

import (
	"reflect"
	"testing"
)

const sectionsTemplate = "## Captura\n\n## Minha síntese\n\n## Testes\n"

func TestParseSections(t *testing.T) {
	t.Run("seções do mesmo nível", func(t *testing.T) {
		s := ParseSections("## A\ntexto a\n## B\ntexto b")
		if len(s) != 2 || s[0].Title != "A" || s[0].Content != "texto a" || s[1].Content != "texto b" {
			t.Fatalf("%+v", s)
		}
	})
	t.Run("subseção faz parte da seção", func(t *testing.T) {
		s := ParseSections("## Síntese\nintro\n### Mapa\nramo\n## Fim\nx")
		if s[0].Content != "intro\n### Mapa\nramo" || s[1].Title != "Mapa" || s[2].Title != "Fim" {
			t.Fatalf("%+v", s)
		}
	})
	t.Run("ignora cabeçalho em cerca de código", func(t *testing.T) {
		s := ParseSections("## Captura\n```md\n## Minha síntese\nfalso\n```\nfim")
		if len(s) != 1 || s[0].Title != "Captura" {
			t.Fatalf("%+v", s)
		}
	})
	t.Run("cerca de ~~~", func(t *testing.T) {
		s := ParseSections("~~~\n## X\n~~~\n## Real\nok")
		if len(s) != 1 || s[0].Title != "Real" {
			t.Fatalf("%+v", s)
		}
	})
	t.Run("seção no fim vai até o fim", func(t *testing.T) {
		s := ParseSections("## A\nx\n## Minha síntese\nlinha 1\nlinha 2")
		if s[1].Content != "linha 1\nlinha 2" {
			t.Fatalf("%+v", s)
		}
	})
	t.Run("cabeçalho vazio tem conteúdo vazio", func(t *testing.T) {
		for _, x := range ParseSections(sectionsTemplate) {
			if x.Content != "" {
				t.Fatalf("%+v", x)
			}
		}
	})
}

func TestChangedProtectedSections(t *testing.T) {
	p := []string{"Minha síntese"}
	cases := []struct {
		name     string
		old, new string
		want     []string
	}{
		{"agente preenche a síntese", sectionsTemplate, "## Captura\n\n## Minha síntese\nconsegui!\n\n## Testes\n", p},
		{"editar outra seção não conta", sectionsTemplate, "## Captura\ntexto novo\n\n## Minha síntese\n\n## Testes\n", nil},
		{"ausente equivale a vazia (corpo vazio)", "", sectionsTemplate, nil},
		{"ausente equivale a vazia (corpo sem a seção)", "## Captura\nx", sectionsTemplate, nil},
		{"síntese idêntica com o resto mudado", "## Captura\na\n## Minha síntese\n- ponto\n", "## Captura\nb\n\n## Minha síntese\n- ponto\n\n## Testes\n[[T]]", nil},
		{"apagar a síntese conta", "## Minha síntese\n- ponto\n", "## Captura\nx", p},
		{"subseção alterada conta", "## Minha síntese\n### Mapa\nramo\n", "## Minha síntese\n### Mapa\nramo editado\n", p},
		{"texto acrescentado no fim conta", "## Captura\nx\n## Minha síntese\n- a", "## Captura\nx\n## Minha síntese\n- a\n- b", p},
		{"título repetido protege todas", "## Minha síntese\nA\n## Outra\nx\n## Minha síntese\nB", "## Minha síntese\nA\n## Outra\nx\n## Minha síntese\nB alterado", p},
		{"sem diferenciar caixa", "## MINHA SÍNTESE\nA", "## minha síntese\nA!", []string{"Minha síntese"}},
		{"cabeçalho falso em cerca", "```\n## Minha síntese\nx\n```", "```\n## Minha síntese\ny\n```", nil},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			got := ChangedProtectedSections(c.old, c.new, p)
			if !reflect.DeepEqual(got, c.want) {
				t.Fatalf("got %v, want %v", got, c.want)
			}
		})
	}
	if got := ChangedProtectedSections("a", "b", nil); got != nil {
		t.Fatalf("sem seções protegidas nunca muda: %v", got)
	}
}
