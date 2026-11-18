import { MAX_DRAWING_BYTES } from '../models/Drawing';

export type DrawingWeightLevel = 'ok' | 'warn' | 'over';

/** Fração do teto a partir da qual o editor avisa. */
export const DRAWING_WARN_RATIO = 0.8;

/** `ok` abaixo de 80% do teto, `warn` de 80% a 100% (inclusive), `over` acima. */
export function drawingWeightLevel(bytes: number, max: number = MAX_DRAWING_BYTES): DrawingWeightLevel {
  if (bytes > max) return 'over';
  if (bytes >= max * DRAWING_WARN_RATIO) return 'warn';
  return 'ok';
}

/** "0 KB", "512 KB", "1,25 MB". KB arredondado para cima abaixo de 1 MB. */
export function formatDrawingBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.ceil(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2).replace('.', ',')} MB`;
}

/** Teto por desenho para textos da UI ("5 MB"), derivado de `MAX_DRAWING_BYTES`. */
export const DRAWING_LIMIT_LABEL = formatDrawingBytes(MAX_DRAWING_BYTES).replace(',00', '');
