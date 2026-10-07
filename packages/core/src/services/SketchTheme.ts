import {
  DARK_INK,
  DARK_LUMINANCE_FLOOR,
  DARK_PALETTE,
  type SketchTheme,
} from '../models/Sketch';

const HEX_RE = /^#[0-9a-fA-F]{6}$/;

/** Luminância relativa (WCAG 2.x) de uma cor `#rrggbb`, em [0, 1]. */
export function relativeLuminance(hex: string): number {
  const channel = (i: number) => {
    const c = parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * channel(0) + 0.7152 * channel(1) + 0.0722 * channel(2);
}

/**
 * Cor com que um traço é EXIBIDO no tema. Nunca altera o que é gravado nem o
 * preview SVG: serve só ao canvas.
 *
 * - tema claro: a própria cor;
 * - tema escuro: a variante clara da paleta; cor fora da paleta fica como está,
 *   exceto se for escura a ponto de sumir no fundo (luminância < 0,18), que vira
 *   `DARK_INK`;
 * - qualquer coisa que não seja `#rrggbb` volta sem mudança.
 */
export function themeColor(color: string, theme: SketchTheme): string {
  if (theme !== 'dark' || !HEX_RE.test(color)) return color;
  const lower = color.toLowerCase();
  const mapped = DARK_PALETTE[lower];
  if (mapped) return mapped;
  return relativeLuminance(lower) < DARK_LUMINANCE_FLOOR ? DARK_INK : color;
}
