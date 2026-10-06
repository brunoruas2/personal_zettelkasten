import Dexie, { type Table } from 'dexie';
import type {
  Zettel,
  ZettelRow,
  Link,
  ReviewRow,
  ReviewState,
  DrawingRecord,
  ZettelRepository as IZettelRepository,
  ReviewRepository as IReviewRepository,
  DrawingRepository as IDrawingRepository,
} from '@zettelkasten/core';
import { rowToZettel, zettelToRow, rowToReview, reviewToRow } from '@zettelkasten/core';

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
  links!: Table<Link, [string, string]>;
  images!: Table<ImageRecord, string>;
  reviews!: Table<ReviewRow, string>;
  drawings!: Table<DrawingRecord, string>;

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
  }
}

const db = new ZettelDb();

export class ZettelRepository implements IZettelRepository {
  async findAll(): Promise<Zettel[]> {
    const rows = await db.zettels.orderBy('updated_at').reverse().toArray();
    return rows.map(rowToZettel);
  }

  async findById(id: string): Promise<Zettel | null> {
    const row = await db.zettels.get(id);
    return row ? rowToZettel(row) : null;
  }

  async findByTitle(title: string): Promise<Zettel | null> {
    const rows = await db.zettels.toArray();
    const row = rows.find((r) => r.title.toLowerCase() === title.toLowerCase());
    return row ? rowToZettel(row) : null;
  }

  async search(query: string): Promise<Zettel[]> {
    if (!query.trim()) return this.findAll();
    const q = query.toLowerCase();
    const rows = await db.zettels.toArray();
    return rows
      .filter(
        (r) =>
          r.title.toLowerCase().includes(q) ||
          r.body.toLowerCase().includes(q) ||
          r.tags.toLowerCase().includes(q),
      )
      .sort((a, b) => b.updated_at - a.updated_at)
      .map(rowToZettel);
  }

  async create(zettel: Zettel): Promise<void> {
    await db.zettels.add(zettelToRow(zettel));
  }

  async update(zettel: Zettel): Promise<void> {
    await db.zettels.put(zettelToRow(zettel));
  }

  async delete(id: string): Promise<void> {
    await db.transaction('rw', db.zettels, db.links, async () => {
      await db.zettels.delete(id);
      await db.links.where('sourceId').equals(id).delete();
      await db.links.where('targetId').equals(id).delete();
    });
  }

  async getBacklinks(id: string): Promise<Zettel[]> {
    const links = await db.links.where('targetId').equals(id).toArray();
    const sourceIds = links.map((l) => l.sourceId);
    if (sourceIds.length === 0) return [];
    const rows = await db.zettels.bulkGet(sourceIds);
    return rows
      .filter((r): r is ZettelRow => r !== undefined)
      .map(rowToZettel)
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
    // As imagens, os estados de revisão e os desenhos entram aqui também: sem isso,
    // o logout deixaria blobs, progresso de estudo e rabiscos de uma sessão
    // visíveis na seguinte.
    await db.transaction('rw', [db.zettels, db.links, db.images, db.reviews, db.drawings], async () => {
      await db.zettels.clear();
      await db.links.clear();
      await db.images.clear();
      await db.reviews.clear();
      await db.drawings.clear();
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
 * Estado de revisão espaçada. Tabela própria, e não colunas em `zettels`: o
 * `put` de linha inteira daquele repositório destruiria campos fora de
 * `zettelToRow`, e cada avaliação viraria uma edição de conteúdo para o sync.
 */
export class ReviewStore implements IReviewRepository {
  async findAll(): Promise<ReviewState[]> {
    const rows = await db.reviews.toArray();
    return rows.map(rowToReview);
  }

  async findById(zettelId: string): Promise<ReviewState | null> {
    const row = await db.reviews.get(zettelId);
    return row ? rowToReview(row) : null;
  }

  async put(state: ReviewState): Promise<void> {
    await db.reviews.put(reviewToRow(state));
  }

  async putMany(states: ReviewState[]): Promise<void> {
    await db.reviews.bulkPut(states.map(reviewToRow));
  }

  async delete(zettelId: string): Promise<void> {
    await db.reviews.delete(zettelId);
  }

  async clearAll(): Promise<void> {
    await db.reviews.clear();
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
