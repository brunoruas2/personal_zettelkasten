package zettel

import (
	"regexp"
	"strings"
)

// Seções de um corpo Markdown. Uma seção começa num cabeçalho `#`…`######` e
// vai até o próximo cabeçalho de nível igual ou menor (subseções fazem parte
// dela) ou até o fim. Cabeçalhos dentro de cercas de código não contam.
// Equivalente em TypeScript: packages/core/src/services/SectionParser.ts, com
// os mesmos casos de teste — mudou aqui, mude lá.

// Section é um trecho de corpo sob um cabeçalho.
type Section struct {
	Title   string
	Level   int
	Content string // abaixo do cabeçalho (inclui subseções), aparado
}

var (
	headingRE = regexp.MustCompile(`^ {0,3}(#{1,6})[ \t]+(.*?)[ \t]*#*[ \t]*$`)
	fenceRE   = regexp.MustCompile("^ {0,3}(`{3,}|~{3,})")
	spaceRE   = regexp.MustCompile(`\s+`)
)

// normalizeTitle: sem caixa, espaços colapsados.
func normalizeTitle(t string) string {
	return spaceRE.ReplaceAllString(strings.ToLower(strings.TrimSpace(t)), " ")
}

// ParseSections separa o corpo em seções.
func ParseSections(body string) []Section {
	lines := strings.Split(strings.ReplaceAll(body, "\r\n", "\n"), "\n")
	type head struct {
		idx   int
		level int
		title string
	}
	var heads []head
	var fenceCh byte
	fenceLen := 0
	for i, line := range lines {
		if m := fenceRE.FindStringSubmatch(line); m != nil {
			ch, n := m[1][0], len(m[1])
			if fenceLen == 0 {
				fenceCh, fenceLen = ch, n
				continue
			}
			// Fecha só com a mesma cerca, de tamanho igual ou maior, sem texto depois.
			if ch == fenceCh && n >= fenceLen && strings.TrimSpace(line) == m[1] {
				fenceLen = 0
			}
			continue
		}
		if fenceLen > 0 {
			continue
		}
		if m := headingRE.FindStringSubmatch(line); m != nil {
			heads = append(heads, head{idx: i, level: len(m[1]), title: strings.TrimSpace(m[2])})
		}
	}
	out := make([]Section, 0, len(heads))
	for n, h := range heads {
		end := len(lines)
		for m := n + 1; m < len(heads); m++ {
			if heads[m].level <= h.level {
				end = heads[m].idx
				break
			}
		}
		out = append(out, Section{
			Title:   h.title,
			Level:   h.level,
			Content: strings.TrimSpace(strings.Join(lines[h.idx+1:end], "\n")),
		})
	}
	return out
}

func contentsOf(sections []Section, key string) []string {
	var out []string
	for _, s := range sections {
		if normalizeTitle(s.Title) == key && s.Content != "" {
			out = append(out, s.Content)
		}
	}
	return out
}

// ChangedProtectedSections devolve os títulos protegidos cujo conteúdo mudou
// entre o corpo anterior e o novo. Seção ausente vale como conteúdo vazio (um
// cabeçalho vazio de template não conta como mudança). Título repetido
// protege todas as ocorrências.
func ChangedProtectedSections(oldBody, newBody string, protected []string) []string {
	if len(protected) == 0 {
		return nil
	}
	before, after := ParseSections(oldBody), ParseSections(newBody)
	var changed []string
	for _, title := range protected {
		key := normalizeTitle(title)
		a, b := contentsOf(before, key), contentsOf(after, key)
		if len(a) != len(b) {
			changed = append(changed, title)
			continue
		}
		for i := range a {
			if a[i] != b[i] {
				changed = append(changed, title)
				break
			}
		}
	}
	return changed
}
