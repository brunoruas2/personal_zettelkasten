/**
 * Roda do mouse × gesto de rolagem do trackpad. O evento não diz qual é;
 * a heurística olha a granularidade do delta: a roda anda em entalhes
 * grandes e inteiros (ou em linhas, `deltaMode = 1`, no Firefox), o trackpad
 * em deltas finos, fracionários ou com componente horizontal.
 *
 * Erra em alguns aparelhos (Magic Mouse, mouses de alta resolução) — o pior
 * caso é pan onde se esperava zoom; `Ctrl`+roda e `+`/`−` seguem garantidos.
 */
export type WheelSource = 'mouse' | 'trackpad';

/** Eventos mais próximos que isso são a mesma rajada e herdam a classificação. */
const BURST_MS = 200;
/** Abaixo disso (px, `deltaMode = 0`) o delta é fino demais para um entalhe. */
const MIN_NOTCH_PX = 40;

export interface WheelMemory {
  source: WheelSource;
  at: number;
}

export function classifyWheel(
  e: Pick<WheelEvent, 'deltaMode' | 'deltaX' | 'deltaY'>,
  now: number,
  last: WheelMemory | null,
): WheelSource {
  // Rajada contínua: um gesto de trackpad que passa por um delta "redondo"
  // não vira zoom no meio.
  if (last && now - last.at < BURST_MS) return last.source;
  if (e.deltaMode !== 0) return 'mouse';
  if (e.deltaX !== 0 || !Number.isInteger(e.deltaY) || Math.abs(e.deltaY) < MIN_NOTCH_PX) return 'trackpad';
  return 'mouse';
}
