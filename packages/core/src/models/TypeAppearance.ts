/**
 * Aparência permitida a um tipo de zettel: listas fechadas. Cor livre poderia
 * cair nas cores reservadas da interface (ciano = agente, âmbar = edição,
 * magenta = perigo) ou ficar ilegível no fundo escuro. O servidor valida contra
 * as mesmas listas (cópia em Go: `internal/types/appearance.go` — mudou aqui,
 * mude lá).
 */
export const TYPE_ICONS = [
  '📘', '📗', '📙', '📕', '🧭', '🗺️', '🧪', '🔬', '📚', '🔖',
  '✏️', '🛠️', '💡', '🧩', '🎯', '📝', '🔗', '🧠', '🌱', '🎓',
] as const;

/** Sem ciano, âmbar nem magenta: essas cores são reservadas. */
export const TYPE_COLORS = [
  '#a78bfa', // violeta
  '#60a5fa', // azul
  '#4ade80', // verde
  '#a3e635', // lima
  '#f87171', // vermelho
  '#818cf8', // índigo
  '#94a3b8', // ardósia
  '#d6d3d1', // pedra
] as const;

export type TypeIcon = (typeof TYPE_ICONS)[number];
export type TypeColor = (typeof TYPE_COLORS)[number];

export function isTypeIcon(v: string): v is TypeIcon {
  return (TYPE_ICONS as readonly string[]).includes(v);
}

export function isTypeColor(v: string): v is TypeColor {
  return (TYPE_COLORS as readonly string[]).includes(v.toLowerCase());
}
