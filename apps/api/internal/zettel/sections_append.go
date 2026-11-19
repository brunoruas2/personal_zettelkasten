package zettel

import "strings"

// AppendToSection acrescenta `text` ao fim da seção `title` (sem caixa) e
// devolve o novo corpo. A seção é a primeira com esse título fora de cerca de
// código; vai até o próximo cabeçalho de nível igual ou menor. Se não existe,
// cria `## title` no fim do corpo. Só mexe no fim da seção: o resto do corpo
// fica como está (terminadores de linha viram \n).
func AppendToSection(body, title, text string) string {
	body = strings.ReplaceAll(body, "\r\n", "\n")
	text = strings.Trim(text, "\n")
	lines := strings.Split(body, "\n")

	type head struct{ idx, level int }
	var heads []head
	var names []string
	var fenceCh byte
	fenceLen := 0
	for i, line := range lines {
		if m := fenceRE.FindStringSubmatch(line); m != nil {
			ch, n := m[1][0], len(m[1])
			if fenceLen == 0 {
				fenceCh, fenceLen = ch, n
			} else if ch == fenceCh && n >= fenceLen && strings.TrimSpace(line) == m[1] {
				fenceLen = 0
			}
			continue
		}
		if fenceLen > 0 {
			continue
		}
		if m := headingRE.FindStringSubmatch(line); m != nil {
			heads = append(heads, head{idx: i, level: len(m[1])})
			names = append(names, normalizeTitle(m[2]))
		}
	}

	key := normalizeTitle(title)
	for n, h := range heads {
		if names[n] != key {
			continue
		}
		end := len(lines)
		for m := n + 1; m < len(heads); m++ {
			if heads[m].level <= h.level {
				end = heads[m].idx
				break
			}
		}
		prefix := strings.TrimRight(strings.Join(lines[:end], "\n"), "\n ")
		rest := strings.Join(lines[end:], "\n")
		if rest == "" {
			return prefix + "\n\n" + text + "\n"
		}
		return prefix + "\n\n" + text + "\n\n" + rest
	}

	trimmed := strings.TrimRight(body, "\n ")
	if trimmed == "" {
		return "## " + title + "\n\n" + text + "\n"
	}
	return trimmed + "\n\n## " + title + "\n\n" + text + "\n"
}
