/**
 * Quebra de linha das cifras no formato acorde-sobre-letra.
 *
 * Um par (linha de acordes, linha de letra) vira segmentos `{ chord, text }`:
 * cada um é o acorde que começa naquela coluna (ou `''`) sobre o pedaço de
 * letra até o próximo corte. Os cortes são o início de cada acorde e o início
 * de cada palavra da letra, então a quebra entre segmentos nunca separa um
 * acorde da sílaba dele. Acorde no meio da palavra corta a palavra ali.
 * Puro: só olha colunas, não sabe o que é um acorde válido.
 */

export interface ChordSegment {
  chord: string;
  text: string;
}

/** O marcador `%c` (compatível com o Obsidian) não ocupa coluna na renderização. */
const CHORD_MARKER = /^%c\s*/;

export function segmentChordPair(chordLine: string, lyricLine: string): ChordSegment[] {
  const chords = new Map<number, string>();
  for (const m of chordLine.replace(CHORD_MARKER, '').matchAll(/\S+/g)) chords.set(m.index!, m[0]);

  const cuts = new Set<number>([0, ...chords.keys()]);
  for (let i = 1; i < lyricLine.length; i++) {
    if (lyricLine[i] !== ' ' && lyricLine[i - 1] === ' ') cuts.add(i);
  }

  const sorted = [...cuts].sort((a, b) => a - b);
  const segments: ChordSegment[] = [];
  sorted.forEach((at, k) => {
    const end = k + 1 < sorted.length ? sorted[k + 1] : lyricLine.length;
    const text = lyricLine.slice(at, Math.max(at, end));
    const chord = chords.get(at) ?? '';
    if (chord || text) segments.push({ chord, text });
  });
  return segments;
}
