import { describe, expect, it } from 'vitest';
import { DARK_INK, DARK_LUMINANCE_FLOOR, SKETCH_COLORS } from '../models/Sketch';
import { relativeLuminance, themeColor } from './SketchTheme';

describe('themeColor', () => {
  it('mapeia as seis cores da paleta para as variantes claras no escuro', () => {
    expect(themeColor('#1e1e1e', 'dark')).toBe('#e8e8e8');
    expect(themeColor('#e03131', 'dark')).toBe('#ff6b6b');
    expect(themeColor('#2f9e44', 'dark')).toBe('#51cf66');
    expect(themeColor('#1971c2', 'dark')).toBe('#4dabf7');
    expect(themeColor('#f08c00', 'dark')).toBe('#ffa94d');
    expect(themeColor('#9c36b5', 'dark')).toBe('#da77f2');
  });

  it('cobre toda a paleta do editor', () => {
    for (const c of SKETCH_COLORS) expect(themeColor(c, 'dark')).not.toBe(c);
  });

  it('no tema claro é identidade, para qualquer cor', () => {
    for (const c of [...SKETCH_COLORS, '#ff00ff', '#000000', 'red', '', '#abc', '#E03131']) {
      expect(themeColor(c, 'light')).toBe(c);
    }
  });

  it('cor fora da paleta é preservada no escuro', () => {
    expect(themeColor('#ff00ff', 'dark')).toBe('#ff00ff');
    expect(themeColor('#FFFFFF', 'dark')).toBe('#FFFFFF');
  });

  it('cor fora da paleta e escura demais vira a tinta clara', () => {
    expect(themeColor('#101010', 'dark')).toBe(DARK_INK);
    expect(themeColor('#000000', 'dark')).toBe(DARK_INK);
    expect(themeColor('#0a0a2a', 'dark')).toBe(DARK_INK);
  });

  it('o limiar de luminância separa #757575 (some) de #767676 (fica)', () => {
    expect(relativeLuminance('#757575')).toBeLessThan(DARK_LUMINANCE_FLOOR);
    expect(relativeLuminance('#767676')).toBeGreaterThanOrEqual(DARK_LUMINANCE_FLOOR);
    expect(themeColor('#757575', 'dark')).toBe(DARK_INK);
    expect(themeColor('#767676', 'dark')).toBe('#767676');
  });

  it('não diferencia maiúsculas de minúsculas na paleta', () => {
    expect(themeColor('#E03131', 'dark')).toBe('#ff6b6b');
    expect(themeColor('#1E1E1E', 'dark')).toBe('#e8e8e8');
  });

  it('entrada que não é #rrggbb volta sem erro e sem mudança', () => {
    for (const bad of ['red', '', '#abc', '#12345', '#1234567', '#gggggg', 'rgb(0,0,0)']) {
      expect(themeColor(bad, 'dark')).toBe(bad);
    }
  });

  it('é idempotente por tema: a mesma entrada dá sempre o mesmo resultado', () => {
    for (const c of [...SKETCH_COLORS, '#ff00ff', '#101010']) {
      expect(themeColor(c, 'dark')).toBe(themeColor(c, 'dark'));
      expect(themeColor(c, 'light')).toBe(themeColor(c, 'light'));
    }
  });

  it('toda cor exibida no escuro tem contraste suficiente com o fundo', () => {
    for (const c of SKETCH_COLORS) {
      expect(relativeLuminance(themeColor(c, 'dark'))).toBeGreaterThanOrEqual(DARK_LUMINANCE_FLOOR);
    }
  });
});

describe('relativeLuminance', () => {
  it('preto = 0 e branco = 1', () => {
    expect(relativeLuminance('#000000')).toBe(0);
    expect(relativeLuminance('#ffffff')).toBeCloseTo(1, 9);
  });

  it('verde pesa mais que azul', () => {
    expect(relativeLuminance('#00ff00')).toBeGreaterThan(relativeLuminance('#0000ff'));
  });
});
