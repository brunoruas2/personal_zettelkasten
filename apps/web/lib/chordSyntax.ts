import { Chord, Interval } from 'tonal';

// Fonte única da sintaxe de cifra: leitura (`components/Chords.tsx`) e editor
// (`createChordDecorations` + barra de tom do `CodeBlockNodeView`) usam as mesmas
// regras — senão o editor pintaria como acorde o que a leitura mostra como texto.

export function isChord(s: string): boolean {
  return s.length > 0 && !Chord.get(s).empty;
}

// A line is a "chord line" when ≥60% of its space-separated tokens are valid
// chord names. The optional %c marker forces chord interpretation.
export function isChordLine(line: string): boolean {
  const tokens = line.replace(/^%c\s*/, '').trim().split(/\s+/).filter(Boolean);
  if (!tokens.length) return false;
  const n = tokens.filter(isChord).length;
  return n > 0 && n / tokens.length >= 0.6;
}

// Inline chord format: [Am]letra [G]aqui. Só conta como acorde quando o conteúdo
// do colchete é um acorde válido — `[Estrofe]`, `[Intro]`, `[Refrão]` são texto.
const BRACKET_RE = /\[([^\]\n]+)\]/g;

export interface InlineChordMatch {
  index: number;
  length: number;
  chord: string;
}

export function inlineChords(line: string): InlineChordMatch[] {
  const out: InlineChordMatch[] = [];
  for (const m of line.matchAll(BRACKET_RE)) {
    if (isChord(m[1])) out.push({ index: m.index ?? 0, length: m[0].length, chord: m[1] });
  }
  return out;
}

export function hasInlineChords(line: string): boolean {
  return inlineChords(line).length > 0;
}

export function tx(chord: string, semitones: number): string {
  if (!semitones) return chord;
  return Chord.transpose(chord, Interval.fromSemitones(semitones)) || chord;
}

function transposeChordLine(line: string, semitones: number): string {
  const prefixMatch = line.match(/^%c\s*/);
  const prefix = prefixMatch ? prefixMatch[0] : '';
  const rest = prefix ? line.slice(prefix.length) : line;
  const parts = rest.split(/(\s+)/).map((p) => (/^\s+$/.test(p) ? p : isChord(p) ? tx(p, semitones) : p));
  return prefix + parts.join('');
}

function transposeInlineLine(line: string, semitones: number): string {
  return line.replace(BRACKET_RE, (whole, chord: string) => (isChord(chord) ? `[${tx(chord, semitones)}]` : whole));
}

export function transposeLine(line: string, semitones: number): string {
  if (hasInlineChords(line)) return transposeInlineLine(line, semitones);
  if (isChordLine(line)) return transposeChordLine(line, semitones);
  return line;
}

// Rebuilds the raw block source with each chord symbol transposed, leaving
// lyrics/spacing/blank lines untouched.
export function transposeSource(source: string, semitones: number): string {
  if (!semitones) return source;
  return source
    .split('\n')
    .map((line) => transposeLine(line, semitones))
    .join('\n');
}

/** Trechos (offsets no texto inteiro) a pintar como acorde: linha de acorde inteira
 *  (como o `ChordLine` da leitura) ou cada `[X]` inline válido. */
export function chordRanges(text: string): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  let offset = 0;
  for (const line of text.split('\n')) {
    const inline = inlineChords(line);
    if (inline.length) {
      for (const m of inline) out.push([offset + m.index, offset + m.index + m.length]);
    } else if (line.trim() && isChordLine(line)) {
      out.push([offset, offset + line.length]);
    }
    offset += line.length + 1;
  }
  return out;
}
