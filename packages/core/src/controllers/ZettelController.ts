import type { Zettel } from '../models/Zettel';

const ID_CHARS = 'abcdefghijklmnopqrstuvwxyz0123456789';

function generateId(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  const date =
    String(now.getFullYear()) +
    pad(now.getMonth() + 1) +
    pad(now.getDate()) +
    pad(now.getHours()) +
    pad(now.getMinutes()) +
    pad(now.getSeconds());
  let rand = '';
  for (let i = 0; i < 4; i++) rand += ID_CHARS[Math.floor(Math.random() * ID_CHARS.length)];
  return date + rand;
}
import { parseLinks } from '../services/LinkParser';
import type { Link } from '../models/Link';

export interface ZettelRepository {
  findAll(): Promise<Zettel[]>;
  findById(id: string): Promise<Zettel | null>;
  findByTitle(title: string): Promise<Zettel | null>;
  search(query: string): Promise<Zettel[]>;
  create(zettel: Zettel): Promise<void>;
  update(zettel: Zettel): Promise<void>;
  delete(id: string): Promise<void>;
  getBacklinks(id: string): Promise<Zettel[]>;
  upsertLinks(sourceId: string, links: Link[]): Promise<void>;
  replaceAllLinks(links: Link[]): Promise<void>;
  getAllLinks(): Promise<Link[]>;
  clearAll(): Promise<void>;
}

export class ZettelController {
  constructor(private readonly repo: ZettelRepository) {}

  async getAll(): Promise<Zettel[]> {
    return this.repo.findAll();
  }

  async getById(id: string): Promise<Zettel | null> {
    return this.repo.findById(id);
  }

  async search(query: string): Promise<Zettel[]> {
    return this.repo.search(query);
  }

  async create(data: Omit<Zettel, 'id' | 'createdAt' | 'updatedAt'>): Promise<Zettel> {
    const now = Date.now();
    const zettel: Zettel = {
      id: generateId(),
      ...data,
      createdAt: now,
      updatedAt: now,
    };

    await this.repo.create(zettel);
    await this._syncLinks(zettel);
    return zettel;
  }

  async update(id: string, data: Partial<Omit<Zettel, 'id' | 'createdAt'>>): Promise<Zettel> {
    const existing = await this.repo.findById(id);
    if (!existing) throw new Error(`Zettel ${id} not found`);

    const updated: Zettel = {
      ...existing,
      ...data,
      updatedAt: Date.now(),
    };

    await this.repo.update(updated);
    await this._syncLinks(updated);
    return updated;
  }

  async delete(id: string): Promise<void> {
    return this.repo.delete(id);
  }

  async getBacklinks(id: string): Promise<Zettel[]> {
    return this.repo.getBacklinks(id);
  }

  async getAllLinks(): Promise<Link[]> {
    return this.repo.getAllLinks();
  }

  async clearAll(): Promise<void> {
    return this.repo.clearAll();
  }

  async rewriteLinks(oldTitle: string, newTitle: string, excludeId: string): Promise<Zettel[]> {
    const all = await this.repo.findAll();
    const escaped = oldTitle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pattern = new RegExp(`\\[\\[(\\^)?${escaped}(\\|[^\\]]*)?\\]\\]`, 'gi');
    const rewritten: Zettel[] = [];

    for (const zettel of all) {
      if (zettel.id === excludeId) continue;
      const lowerBody = zettel.body.toLowerCase();
      const lowerOld = oldTitle.toLowerCase();
      if (!lowerBody.includes(`[[${lowerOld}`) && !lowerBody.includes(`[[^${lowerOld}`)) continue;

      const newBody = zettel.body.replace(pattern, (_, caret, label) =>
        `[[${caret ?? ''}${newTitle}${label ?? ''}]]`
      );

      if (newBody !== zettel.body) {
        const updated: Zettel = { ...zettel, body: newBody, updatedAt: Date.now() };
        await this.repo.update(updated);
        rewritten.push(updated);
      }
    }

    return rewritten;
  }

  private async _syncLinks(zettel: Zettel): Promise<void> {
    const parsed = parseLinks(zettel.body);
    const seen = new Set<string>();
    const links: Link[] = [];

    for (const p of parsed) {
      const target = await this.repo.findByTitle(p.target);
      if (target && !seen.has(target.id)) {
        seen.add(target.id);
        const link: Link = { sourceId: zettel.id, targetId: target.id };
        if (p.isParentRef) link.type = 'parent-ref';
        links.push(link);
      }
    }

    await this.repo.upsertLinks(zettel.id, links);
  }
}
