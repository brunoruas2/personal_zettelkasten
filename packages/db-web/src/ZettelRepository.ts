import Dexie, { type Table } from 'dexie';
import type { Zettel, ZettelRow, Link, ZettelRepository as IZettelRepository } from '@zettelkasten/core';
import { rowToZettel, zettelToRow } from '@zettelkasten/core';

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
    // As imagens entram aqui também: sem isso, o logout deixaria blobs de uma
    // sessão visíveis na seguinte.
    await db.transaction('rw', db.zettels, db.links, db.images, async () => {
      await db.zettels.clear();
      await db.links.clear();
      await db.images.clear();
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
