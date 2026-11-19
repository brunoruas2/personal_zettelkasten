package zettel

import "testing"

func TestAppendToSection(t *testing.T) {
	cases := []struct {
		name, body, want string
	}{
		{"fim do corpo", "## Sessões\n\nA\n", "## Sessões\n\nA\n\nNOVO\n"},
		{"antes de outra seção", "## Sessões\n\nA\n\n## Outra\n\nx\n", "## Sessões\n\nA\n\nNOVO\n\n## Outra\n\nx\n"},
		{"subseção fica dentro", "## Sessões\n\n### d1\n\nA\n\n## Fim\n", "## Sessões\n\n### d1\n\nA\n\nNOVO\n\n## Fim\n"},
		{"seção vazia", "## Sessões\n\n## Fim\n", "## Sessões\n\nNOVO\n\n## Fim\n"},
		{"ausente cria no fim", "texto\n\n## Outra\n\nx\n", "texto\n\n## Outra\n\nx\n\n## Sessões\n\nNOVO\n"},
		{"corpo vazio", "", "## Sessões\n\nNOVO\n"},
		{"sem caixa", "## sessões\n\nA", "## sessões\n\nA\n\nNOVO\n"},
		{"cabeçalho em cerca não conta", "```\n## Sessões\n```\n\n## Outra\n", "```\n## Sessões\n```\n\n## Outra\n\n## Sessões\n\nNOVO\n"},
		{"crlf vira lf", "## Sessões\r\n\r\nA\r\n", "## Sessões\n\nA\n\nNOVO\n"},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			if got := AppendToSection(c.body, "Sessões", "NOVO"); got != c.want {
				t.Fatalf("got %q\nwant %q", got, c.want)
			}
		})
	}
}

func TestAppendToSectionPreservesEarlierSessions(t *testing.T) {
	body := "## Sessões\n\n### 2026-01-01 — passou\n- [recuperacao] P → R (acertou)\n"
	got := AppendToSection(body, "Sessões", "### 2026-02-01 — parcial")
	if got[:len(body)-1] != body[:len(body)-1] {
		t.Fatalf("sessão anterior mudou: %q", got)
	}
}
