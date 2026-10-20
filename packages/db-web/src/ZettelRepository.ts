import Dexie, { type Table } from 'dexie';
import type {
  Zettel,
  ZettelMeta,
  ZettelRow,
  BodyEntry,
  Link,
  DrawingRecord,
  PositionRecord,
  ZettelRepository as IZettelRepository,
  DrawingRepository as IDrawingRepository,
} from '@zettelkasten/core';
import { rowToMeta, metaToRow, utf8Length } from '@zettelkasten/core';

/** Corpo de um zettel, fora da linha de metadados (ver `version(18)`). */
interface BodyRow {
  id: string;
  body: string;
}

/**
 * Imagem guardada localmente. O `blob` é um Blob nativo — Dexie persiste isso
 * direto, então nada de base64 no IndexedDB.
 *
 * `syncState` é a própria fila de upload: a fila de zettels vive no
 * localStorage (string-only, ~5 MB) e estouraria com bytes de imagem.
 */
export interface ImageRecord {
  id: string;
  blob: Blob;
  mime: string;
  width: number;
  height: number;
  byteLen: number;
  createdAt: number;
  // `rejected` é terminal: o servidor recusou de forma permanente (quota,
  // tamanho, formato) e re-tentar não muda o resultado.
  syncState: 'pending' | 'synced' | 'rejected';
}

class ZettelDb extends Dexie {
  zettels!: Table<ZettelRow, string>;
  bodies!: Table<BodyRow, string>;
  links!: Table<Link, [string, string]>;
  images!: Table<ImageRecord, string>;
  drawings!: Table<DrawingRecord, string>;
  positions!: Table<PositionRecord, string>;

  constructor() {
    super('zettelkasten');
    this.version(1).stores({
      zettels: 'id, title, updated_at',
      links: '[sourceId+targetId], sourceId, targetId',
    });
    this.version(11).stores({
      zettels: 'id, title, updated_at, is_public',
      links: '[sourceId+targetId], sourceId, targetId',
    });
    this.version(12).stores({
      zettels: 'id, title, updated_at',
      links: '[sourceId+targetId], sourceId, targetId',
    });
    this.version(13).stores({
      zettels: 'id, title, updated_at',
      links: '[sourceId+targetId], sourceId, targetId',
      images: 'id, syncState',
    });
    // Tabela nova, nada a converter — sem `.upgrade()`.
    this.version(14).stores({
      zettels: 'id, title, updated_at',
      links: '[sourceId+targetId], sourceId, targetId',
      images: 'id, syncState',
      reviews: 'zettel_id, due_at',
    });
    // Tabela nova, nada a converter — sem `.upgrade()`.
    this.version(15).stores({
      zettels: 'id, title, updated_at',
      links: '[sourceId+targetId], sourceId, targetId',
      images: 'id, syncState',
      reviews: 'zettel_id, due_at',
      drawings: 'id, syncState, updatedAt',
    });
    // Revisão espaçada removida do app: `null` apaga a tabela na abertura. As
    // versões 14 e 15 ficam como estão — descrevem o caminho de upgrade de quem
    // ainda está nelas.
    this.version(16).stores({
      zettels: 'id, title, updated_at',
      links: '[sourceId+targetId], sourceId, targetId',
      images: 'id, syncState',
      reviews: null,
      drawings: 'id, syncState, updatedAt',
    });
    // Posições da galáxia: tabela nova, nada a converter — sem `.upgrade()`.
    this.version(17).stores({
      zettels: 'id, title, updated_at',
      links: '[sourceId+targetId], sourceId, targetId',
      images: 'id, syncState',
      drawings: 'id, syncState, updatedAt',
      positions: 'id, syncState, updatedAt',
    });
    // Corpo fora da linha de metadados: o IndexedDB não projeta campos, então
    // listar os zettels traria todos os corpos para o heap. Primeiro
    // `.upgrade()` do projeto — move cada corpo para `bodies` e marca a versão
    // local (`body_at = updated_at`), para nada migrado ser baixado de novo.
    this.version(18)
      .stores({
        zettels: 'id, title, updated_at',
        bodies: 'id',
        links: '[sourceId+targetId], sourceId, targetId',
        images: 'id, syncState',
        drawings: 'id, syncState, updatedAt',
        positions: 'id, syncState, updatedAt',
      })
      .upgrade(async (tx) => {
        const bodies: BodyRow[] = [];
        await tx
          .table('zettels')
          .toCollection()
          .modify((row: ZettelRow & { body?: string }) => {
            const body = row.body ?? '';
            bodies.push({ id: row.id, body });
            row.body_len = utf8Length(body);
            row.body_at = row.updated_at;
            delete row.body;
          });
        await tx.table('bodies').bulkPut(bodies);
      });
  }
}

const db = new ZettelDb();

export class ZettelRepository implements IZettelRepository {
  async listMeta(): Promise<ZettelMeta[]> {
    const rows = await db.zettels.orderBy('updated_at').reverse().toArray();
    return rows.map(rowToMeta);
  }

  async findById(id: string): Promise<Zettel | null> {
    const [row, body] = await Promise.all([db.zettels.get(id), db.bodies.get(id)]);
    return row ? { ...rowToMeta(row), body: body?.body ?? '' } : null;
  }

  async findByTitle(title: string): Promise<ZettelMeta | null> {
    const lower = title.toLowerCase();
    const row = await db.zettels.filter((r) => r.title.toLowerCase() === lower).first();
    return row ? rowToMeta(row) : null;
  }

  async getBody(id: string): Promise<string | null> {
    return (await db.bodies.get(id))?.body ?? null;
  }

  async getBodies(ids: string[]): Promise<Map<string, string>> {
    const rows = await db.bodies.bulkGet(ids);
    const out = new Map<string, string>();
    for (const r of rows) if (r) out.set(r.id, r.body);
    return out;
  }

  // Cursor: um corpo por vez no heap, nunca a tabela inteira.
  async eachBody(cb: (id: string, body: string) => void): Promise<void> {
    await db.bodies.each((r) => cb(r.id, r.body));
  }

  async searchBodies(query: string, limit: number, skip: Set<string>): Promise<string[]> {
    const out: string[] = [];
    if (!query) return out;
    await db.bodies
      .filter((r) => !skip.has(r.id) && r.body.toLowerCase().includes(query))
      .until(() => out.length >= limit)
      .each((r) => {
        if (out.length < limit) out.push(r.id);
      });
    return out;
  }

  async putBodies(entries: BodyEntry[]): Promise<string[]> {
    if (entries.length === 0) return [];
    const applied: string[] = [];
    await db.transaction('rw', db.zettels, db.bodies, async () => {
      const rows = await db.zettels.bulkGet(entries.map((e) => e.id));
      const metas: ZettelRow[] = [];
      const bodies: BodyRow[] = [];
      entries.forEach((e, i) => {
        const row = rows[i];
        // Edição local mais nova (ou zettel apagado aqui) vence o que veio do servidor.
        if (!row || e.at < row.updated_at) return;
        metas.push({ ...row, body_at: e.at, body_len: utf8Length(e.body) });
        bodies.push({ id: e.id, body: e.body });
        applied.push(e.id);
      });
      await db.zettels.bulkPut(metas);
      await db.bodies.bulkPut(bodies);
    });
    return applied;
  }

  async upsertMeta(metas: Omit<ZettelMeta, 'bodyAt'>[]): Promise<void> {
    if (metas.length === 0) return;
    await db.transaction('rw', db.zettels, async () => {
      const existing = await db.zettels.bulkGet(metas.map((m) => m.id));
      await db.zettels.bulkPut(
        metas.map((m, i) => metaToRow({ ...m, bodyAt: existing[i]?.body_at ?? null })),
      );
    });
  }

  async create(zettel: Zettel): Promise<void> {
    await db.transaction('rw', db.zettels, db.bodies, async () => {
      await db.zettels.add(metaToRow(zettel));
      await db.bodies.put({ id: zettel.id, body: zettel.body });
    });
  }

  async update(zettel: Zettel): Promise<void> {
    await db.transaction('rw', db.zettels, db.bodies, async () => {
      await db.zettels.put(metaToRow(zettel));
      await db.bodies.put({ id: zettel.id, body: zettel.body });
    });
  }

  async delete(id: string): Promise<void> {
    await db.transaction('rw', db.zettels, db.bodies, db.links, async () => {
      await db.zettels.delete(id);
      await db.bodies.delete(id);
      await db.links.where('sourceId').equals(id).delete();
      await db.links.where('targetId').equals(id).delete();
    });
  }

  async getBacklinks(id: string): Promise<ZettelMeta[]> {
    const links = await db.links.where('targetId').equals(id).toArray();
    const sourceIds = links.map((l) => l.sourceId);
    if (sourceIds.length === 0) return [];
    const rows = await db.zettels.bulkGet(sourceIds);
    return rows
      .filter((r): r is ZettelRow => r !== undefined)
      .map(rowToMeta)
      .sort((a, b) => a.title.localeCompare(b.title, 'pt-BR'));
  }

  async upsertLinks(sourceId: string, links: Link[]): Promise<void> {
    await db.transaction('rw', db.links, async () => {
      await db.links.where('sourceId').equals(sourceId).delete();
      if (links.length > 0) {
        await db.links.bulkPut(links);
      }
    });
  }

  async replaceAllLinks(links: Link[]): Promise<void> {
    await db.transaction('rw', db.links, async () => {
      await db.links.clear();
      if (links.length > 0) {
        await db.links.bulkAdd(links);
      }
    });
  }

  async getAllLinks(): Promise<Link[]> {
    return db.links.toArray();
  }

  async clearAll(): Promise<void> {
    // Corpos, imagens, desenhos e posições entram aqui também: sem isso, o
    // logout deixaria conteúdo de uma sessão visível na seguinte.
    await db.transaction('rw', [db.zettels, db.bodies, db.links, db.images, db.drawings, db.positions], async () => {
      await db.zettels.clear();
      await db.bodies.clear();
      await db.links.clear();
      await db.images.clear();
      await db.drawings.clear();
      await db.positions.clear();
    });
  }
}

/**
 * Acesso aos blobs de imagem. Fica fora de `ZettelRepository` de propósito: a
 * interface daquele contrato mora em `packages/core`, e core não pode importar
 * tipos de DOM — `Blob` é DOM.
 */
export class ImageStore {
  async get(id: string): Promise<ImageRecord | undefined> {
    return db.images.get(id);
  }

  async has(id: string): Promise<boolean> {
    return (await db.images.where('id').equals(id).count()) > 0;
  }

  async put(record: ImageRecord): Promise<void> {
    await db.images.put(record);
  }

  async delete(id: string): Promise<void> {
    await db.images.delete(id);
  }

  async listIds(): Promise<string[]> {
    return db.images.toCollection().primaryKeys();
  }

  async listPending(): Promise<ImageRecord[]> {
    return db.images.where('syncState').equals('pending').toArray();
  }

  async markSynced(id: string): Promise<void> {
    await db.images.update(id, { syncState: 'synced' });
  }

  async markRejected(id: string): Promise<void> {
    await db.images.update(id, { syncState: 'rejected' });
  }

  async countRejected(): Promise<number> {
    return db.images.where('syncState').equals('rejected').count();
  }

  async usedBytes(): Promise<number> {
    let total = 0;
    await db.images.each((r) => {
      total += r.byteLen;
    });
    return total;
  }
}

/**
 * Desenhos (cena de traços + preview SVG). Tabela própria pelo mesmo motivo das
 * imagens: o JSON da cena não pode morar em `zettels.body`, que o servidor indexa
 * no FTS5. `syncState` é a fila de upload — registro vazio (`scene === ''`) nasce
 * `synced` porque não há o que enviar.
 */
export class DrawingStore implements IDrawingRepository {
  async get(id: string): Promise<DrawingRecord | undefined> {
    return db.drawings.get(id);
  }

  async put(record: DrawingRecord): Promise<void> {
    await db.drawings.put(record);
  }

  async delete(id: string): Promise<void> {
    await db.drawings.delete(id);
  }

  async listIds(): Promise<string[]> {
    return db.drawings.toCollection().primaryKeys();
  }

  async listPending(): Promise<DrawingRecord[]> {
    return db.drawings.where('syncState').equals('pending').toArray();
  }

  /**
   * Só vira `synced` se o registro ainda é o que foi enviado: uma edição feita
   * durante o upload avança `updatedAt` e precisa continuar `pending`.
   */
  async markSynced(id: string, updatedAt: number): Promise<void> {
    await db.transaction('rw', db.drawings, async () => {
      const row = await db.drawings.get(id);
      if (row && row.updatedAt === updatedAt) {
        await db.drawings.update(id, { syncState: 'synced' });
      }
    });
  }

  async markRejected(id: string): Promise<void> {
    await db.drawings.update(id, { syncState: 'rejected' });
  }

  async countRejected(): Promise<number> {
    return db.drawings.where('syncState').equals('rejected').count();
  }

  async usedBytes(): Promise<number> {
    let total = 0;
    await db.drawings.each((r) => {
      total += r.byteLen;
    });
    return total;
  }

  async clearAll(): Promise<void> {
    await db.drawings.clear();
  }
}

/**
 * Posições da galáxia. `syncState` é a própria fila de envio, como nos
 * desenhos; `mode` diz como o servidor deve tratar o registro pendente.
 */
export class PositionStore {
  async getAll(): Promise<PositionRecord[]> {
    return db.positions.toArray();
  }

  async get(id: string): Promise<PositionRecord | undefined> {
    return db.positions.get(id);
  }

  async putMany(records: PositionRecord[]): Promise<void> {
    if (records.length === 0) return;
    await db.positions.bulkPut(records);
  }

  async listPending(): Promise<PositionRecord[]> {
    return db.positions.where('syncState').equals('pending').toArray();
  }

  /**
   * Só vira `synced` se o registro ainda é o que foi enviado: uma gravação
   * feita durante o envio avança `updatedAt` e precisa continuar `pending`.
   */
  async markSynced(id: string, updatedAt: number): Promise<void> {
    await db.transaction('rw', db.positions, async () => {
      const row = await db.positions.get(id);
      if (row && row.updatedAt === updatedAt && row.syncState === 'pending') {
        await db.positions.update(id, { syncState: 'synced' });
      }
    });
  }

  /**
   * Troca o registro pelo `next` só se o local ainda é o enviado (mesmo
   * `updatedAt`). Usado para adotar a posição que o servidor manteve.
   */
  async replaceIfUnchanged(sentUpdatedAt: number, next: PositionRecord): Promise<void> {
    await db.transaction('rw', db.positions, async () => {
      const row = await db.positions.get(next.id);
      if (row && row.updatedAt === sentUpdatedAt && row.syncState === 'pending') {
        await db.positions.put(next);
      }
    });
  }

  async delete(id: string): Promise<void> {
    await db.positions.delete(id);
  }

  async count(): Promise<number> {
    return db.positions.count();
  }

  async clear(): Promise<void> {
    await db.positions.clear();
  }
}
