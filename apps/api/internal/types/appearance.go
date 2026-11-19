package types

import "strings"

// Listas fechadas de ícone e cor de um tipo. Cópia de
// packages/core/src/models/TypeAppearance.ts — mudou lá, mude aqui.
// A paleta não tem ciano (agente), âmbar (edição) nem magenta (perigo).
var icons = map[string]bool{}

var colors = map[string]bool{}

func init() {
	for _, i := range []string{
		"📘", "📗", "📙", "📕", "🧭", "🗺️", "🧪", "🔬", "📚", "🔖",
		"✏️", "🛠️", "💡", "🧩", "🎯", "📝", "🔗", "🧠", "🌱", "🎓",
	} {
		icons[i] = true
	}
	for _, c := range []string{
		"#a78bfa", "#60a5fa", "#4ade80", "#a3e635",
		"#f87171", "#818cf8", "#94a3b8", "#d6d3d1",
	} {
		colors[c] = true
	}
}

// ValidIcon diz se o emoji está na lista permitida.
func ValidIcon(s string) bool { return icons[s] }

// ValidColor diz se a cor está na paleta permitida (sem diferenciar caixa).
func ValidColor(s string) bool { return colors[strings.ToLower(s)] }
