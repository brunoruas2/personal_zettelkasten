/**
 * Posição de um zettel na galáxia: centro do card, em coordenadas de mundo
 * (px de CSS com zoom 1), sempre inteiras. Tabela própria, fora de `zettels`:
 * mexer na linha do zettel dispararia os triggers do FTS5 e faria todo
 * dispositivo rebaixar o corpo no pull delta.
 */
export interface GalaxyPosition {
  id: string;
  x: number;
  y: number;
  updatedAt: number;
}

/**
 * `lww` — movimento explícito, vence o `updated_at` maior.
 * `if_absent` — posicionamento automático, nunca sobrescreve posição existente
 * (o primeiro dispositivo a gravar vence e os outros adotam a do servidor).
 */
export type PositionWriteMode = 'lww' | 'if_absent';

export interface PositionRecord extends GalaxyPosition {
  syncState: 'pending' | 'synced';
  mode: PositionWriteMode;
}

/** Forma no servidor (`/api/positions`); timestamps em ms. */
export interface ServerPosition {
  id: string;
  x: number;
  y: number;
  updated_at: number;
}

export const CARD_WIDTH = 640;
/** Calibrado medindo as alturas reais dos zettels (p80, múltiplo de 40). */
export const CARD_MAX_HEIGHT = 720;
export const CARD_GAP = 48;

/** Pegada reservada por zettel: o card na altura máxima mais a folga. */
export const FOOTPRINT_W = CARD_WIDTH + CARD_GAP;
export const FOOTPRINT_H = CARD_MAX_HEIGHT + CARD_GAP;

export interface Point {
  x: number;
  y: number;
}

/** Duas pegadas centradas em `a` e `b` se intersectam. */
export function footprintsOverlap(a: Point, b: Point): boolean {
  return Math.abs(a.x - b.x) < FOOTPRINT_W && Math.abs(a.y - b.y) < FOOTPRINT_H;
}
