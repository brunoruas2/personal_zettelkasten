/**
 * Notas do teclado de piano para blocos ```abc: nota → texto ABC e nota → MIDI.
 *
 * Oitava científica (C4 = dó central = MIDI 60). Em ABC, a oitava 4 é a letra
 * maiúscula (`C`), a 5 a minúscula (`c`); abaixo da 4 cada oitava soma uma `,`
 * e acima da 5 cada oitava soma um `'`. Teclas pretas são sempre sustenido (`^`).
 * Puro: não toca em áudio nem em editor.
 */

export interface PianoKey {
  /** Semitom dentro da oitava: 0 = C … 11 = B. */
  semitone: number;
  /** Rótulo da tecla (`C`, `C♯`, …). */
  label: string;
  black: boolean;
}

export const PIANO_KEYS: readonly PianoKey[] = [
  { semitone: 0, label: 'C', black: false },
  { semitone: 1, label: 'C♯', black: true },
  { semitone: 2, label: 'D', black: false },
  { semitone: 3, label: 'D♯', black: true },
  { semitone: 4, label: 'E', black: false },
  { semitone: 5, label: 'F', black: false },
  { semitone: 6, label: 'F♯', black: true },
  { semitone: 7, label: 'G', black: false },
  { semitone: 8, label: 'G♯', black: true },
  { semitone: 9, label: 'A', black: false },
  { semitone: 10, label: 'A♯', black: true },
  { semitone: 11, label: 'B', black: false },
];

export const MIN_OCTAVE = 2;
export const MAX_OCTAVE = 6;
export const DEFAULT_OCTAVE = 4;

/** Durações relativas ao `L:` do bloco: o sufixo é o que vai depois da nota. */
export const ABC_DURATIONS: readonly { label: string; suffix: string }[] = [
  { label: '½', suffix: '/2' },
  { label: '1', suffix: '' },
  { label: '2', suffix: '2' },
  { label: '4', suffix: '4' },
];

/** Letra da nota natural (ou da natural abaixo, para as pretas) por semitom. */
const LETTERS = ['C', 'C', 'D', 'D', 'E', 'F', 'F', 'G', 'G', 'A', 'A', 'B'];
const SHARPS = new Set([1, 3, 6, 8, 10]);

export function clampOctave(octave: number): number {
  return Math.min(MAX_OCTAVE, Math.max(MIN_OCTAVE, Math.round(octave)));
}

/** Nota MIDI: `12 × (oitava + 1) + semitom` (C4 = 60). */
export function noteToMidi(semitone: number, octave: number): number {
  return 12 * (octave + 1) + semitone;
}

/** Texto ABC da nota na oitava dada, com o sufixo de duração opcional. */
export function noteToAbc(semitone: number, octave: number, durationSuffix = ''): string {
  const letter = LETTERS[semitone];
  const accidental = SHARPS.has(semitone) ? '^' : '';
  let pitch: string;
  if (octave >= 5) pitch = letter.toLowerCase() + "'".repeat(octave - 5);
  else pitch = letter + ','.repeat(4 - octave);
  return `${accidental}${pitch}${durationSuffix}`;
}
