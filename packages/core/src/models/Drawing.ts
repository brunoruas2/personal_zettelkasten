/**
 * Desenho (cena de traços + preview SVG). Tabela própria, fora de `zettels`:
 * o JSON da cena entraria no índice FTS5 do servidor e degradaria a busca.
 *
 * O corpo do zettel guarda só `![alt](zk:draw/<id>)`. O `id` é gerado uma vez e
 * não muda ao editar (ao contrário da imagem, que é content-addressed).
 */
export interface DrawingRecord {
  id: string;
  /** JSON da cena (`type: "zk-sketch"`; `"excalidraw"` é legado); string vazia = desenho recém-criado, ainda sem conteúdo. */
  scene: string;
  /** Preview SVG gerado no client no momento de salvar; vazio junto com `scene`. */
  svg: string;
  /** `scene.length + svg.length` em bytes UTF-8 — o que conta para teto e quota. */
  byteLen: number;
  width: number;
  height: number;
  createdAt: number;
  updatedAt: number;
  // `rejected` é terminal: o servidor recusou de forma permanente (quota,
  // tamanho, formato) e re-tentar não muda o resultado.
  syncState: 'pending' | 'synced' | 'rejected';
}

/** Teto por desenho (cena + SVG), igual ao do servidor. */
export const MAX_DRAWING_BYTES = 2 * 1024 * 1024;

/** Forma de um desenho no servidor (`GET /api/drawings/{id}`); timestamps em ms. */
export interface ServerDrawing {
  id: string;
  scene: string;
  svg: string;
  byte_len: number;
  width: number;
  height: number;
  created_at: number;
  updated_at: number;
}

export interface DrawingManifestEntry {
  id: string;
  updated_at: number;
  byte_len: number;
}

export function serverDrawingToRecord(d: ServerDrawing): DrawingRecord {
  return {
    id: d.id,
    scene: d.scene,
    svg: d.svg,
    byteLen: d.byte_len,
    width: d.width,
    height: d.height,
    createdAt: d.created_at,
    updatedAt: d.updated_at,
    syncState: 'synced',
  };
}

/** Contrato de acesso local. A implementação concreta mora em `packages/db-web`. */
export interface DrawingRepository {
  get(id: string): Promise<DrawingRecord | undefined>;
  put(record: DrawingRecord): Promise<void>;
  delete(id: string): Promise<void>;
  listIds(): Promise<string[]>;
  listPending(): Promise<DrawingRecord[]>;
  markSynced(id: string, updatedAt: number): Promise<void>;
  markRejected(id: string): Promise<void>;
  countRejected(): Promise<number>;
  usedBytes(): Promise<number>;
  clearAll(): Promise<void>;
}
