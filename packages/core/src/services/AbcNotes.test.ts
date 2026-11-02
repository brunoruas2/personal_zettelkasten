import { describe, it, expect } from 'vitest';
import {
  PIANO_KEYS,
  ABC_DURATIONS,
  MIN_OCTAVE,
  MAX_OCTAVE,
  DEFAULT_OCTAVE,
  clampOctave,
  noteToAbc,
  noteToMidi,
} from './AbcNotes';

describe('noteToMidi', () => {
  it('C4 é 60', () => expect(noteToMidi(0, 4)).toBe(60));
  it('A5 é 81', () => expect(noteToMidi(9, 5)).toBe(81));
  it('cobre a faixa 2–6', () => {
    expect(noteToMidi(0, MIN_OCTAVE)).toBe(36);
    expect(noteToMidi(11, MAX_OCTAVE)).toBe(95);
  });
});

describe('noteToAbc', () => {
  it('oitava 4 é maiúscula', () => expect(noteToAbc(0, 4)).toBe('C'));
  it('oitava 5 é minúscula', () => expect(noteToAbc(0, 5)).toBe('c'));
  it('abaixo da 4 soma vírgulas', () => {
    expect(noteToAbc(7, 3)).toBe('G,');
    expect(noteToAbc(0, 2)).toBe('C,,');
  });
  it("acima da 5 soma apóstrofos", () => {
    expect(noteToAbc(2, 6)).toBe("d'");
    expect(noteToAbc(0, 6)).toBe("c'");
  });
  it('sustenido leva ^ antes da nota', () => {
    expect(noteToAbc(1, 4)).toBe('^C');
    expect(noteToAbc(10, 5)).toBe('^a');
    expect(noteToAbc(6, 3)).toBe('^F,');
  });
  it('anexa o sufixo de duração', () => {
    expect(noteToAbc(4, 4, '2')).toBe('E2');
    expect(noteToAbc(4, 4, '/2')).toBe('E/2');
    expect(noteToAbc(1, 5, '4')).toBe('^c4');
  });
});

describe('PIANO_KEYS', () => {
  it('tem 12 teclas, 7 brancas e 5 pretas', () => {
    expect(PIANO_KEYS).toHaveLength(12);
    expect(PIANO_KEYS.filter((k) => !k.black)).toHaveLength(7);
    expect(PIANO_KEYS.filter((k) => k.black)).toHaveLength(5);
  });
  it('semitons vão de 0 a 11 em ordem', () => {
    expect(PIANO_KEYS.map((k) => k.semitone)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
  });
});

describe('clampOctave / constantes', () => {
  it('limita a 2–6', () => {
    expect(clampOctave(1)).toBe(2);
    expect(clampOctave(7)).toBe(6);
    expect(clampOctave(4)).toBe(4);
  });
  it('oitava inicial é 4', () => expect(DEFAULT_OCTAVE).toBe(4));
  it('duração padrão (1) não tem sufixo', () => {
    expect(ABC_DURATIONS.find((d) => d.label === '1')?.suffix).toBe('');
  });
});
