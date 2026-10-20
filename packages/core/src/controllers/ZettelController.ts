import type { BodyEntry, Zettel, ZettelMeta } from '../models/Zettel';
import { isBodyStale, utf8Length } from '../models/Zettel';

const ID_CHARS = 'abcdefghijklmnopqrstuvwxyz0123456789';

export function generateId(): string {
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
import { parseLinks, rewriteLinkTitle } from '../services/LinkParser';
import type { Link } from '../models/Link';

export interface ZettelRepository {
  /** Metadados de todos os zettels, sem corpo. */
  listMeta(): Promise<ZettelMeta[]>;
  /** Meta + corpo local (`''` se nunca baixado — `bodyAt` diz qual é o caso). */
  findById(id: string): Promise<Zettel | null>;
  findByTitle(title: string): Promise<ZettelMeta | null>;
  getBody(id: string): Promise<string | null>;
  getBodies(ids: string[]): Promise<Map<string, string>>;
  /** Percorre os corpos locais um a um (cursor), sem acumular. */
  eachBody(cb: (id: string, body: string) => void): Promise<void>;
  /** Ids cujo corpo contém `query` (já em minúsculas), até `limit`, pulando `skip`. */
  searchBodies(query: string, limit: number, skip: Set<string>): Promise<string[]>;
  /**
   * Grava corpos vindos do servidor. Só aplica se `at >= updatedAt` da meta
   * local — uma edição local mais nova vence. Devolve os ids aplicados.
   */
  putBodies(entries: BodyEntry[]): Promise<string[]>;
  /** Pull do índice: grava metas preservando o corpo local e o `bodyAt`. */
  upsertMeta(metas: Omit<ZettelMeta, 'bodyAt'>[]): Promise<void>;
  /** Grava meta + corpo na mesma transação. */
  create(zettel: Zettel): Promise<void>;
  update(zettel: Zettel): Promise<void>;
  delete(id: string): Promise<void>;
  getBacklinks(id: string): Promise<ZettelMeta[]>;
  upsertLinks(sourceId: string, links: Link[]): Promise<void>;
  replaceAllLinks(links: Link[]): Promise<void>;
  getAllLinks(): Promise<Link[]>;
  clearAll(): Promise<void>;
}

/** Limite de zettels que casam só pelo corpo na busca local. */
export const BODY_SEARCH_LIMIT = 200;

/** Editar exige o corpo atual: salvar sobre um corpo velho apagaria no servidor a versão nova. */
export class StaleBodyError extends Error {
  constructor(id: string) {
    super(`Zettel ${id} has a stale local body`);
    this.name = 'StaleBodyError';
  }
}

export interface RewriteResult {
  rewritten: Zettel[];
  /** Zettels citando o título antigo cujo corpo local está desatualizado: não foram tocados. */
  skippedStale: string[];
}

export class ZettelController {
  constructor(private readonly repo: ZettelRepository) {}

  async getAll(): Promise<ZettelMeta[]> {
    return this.repo.listMeta();
  }

  async getById(id: string): Promise<Zettel | null> {
    return this.repo.findById(id);
  }

  async getBodies(ids: string[]): Promise<Map<string, string>> {
    return this.repo.getBodies(ids);
  }

  /**
   * Busca local híbrida: título e tags casam pelo índice; o corpo é varrido
   * por cursor depois. Ordem: título, tag, só corpo — sem duplicatas.
   */
  async search(query: string): Promise<ZettelMeta[]> {
    const q = query.trim().toLowerCase();
    const metas = await this.repo.listMeta();
    if (!q) return metas;

    const byTitle: ZettelMeta[] = [];
    const byTag: ZettelMeta[] = [];
    for (const m of metas) {
      if (m.title.toLowerCase().includes(q)) byTitle.push(m);
      else if (m.tags.some((t) => t.toLowerCase().includes(q))) byTag.push(m);
    }
    const seen = new Set([...byTitle, ...byTag].map((m) => m.id));
    const bodyIds = await this.repo.searchBodies(q, BODY_SEARCH_LIMIT, seen);
    const metaById = new Map(metas.map((m) => [m.id, m]));
    const byBody = bodyIds.map((id) => metaById.get(id)).filter((m): m is ZettelMeta => !!m);
    return [...byTitle, ...byTag, ...byBody];
  }

  async create(data: Pick<Zettel, 'title' | 'body' | 'tags'>): Promise<Zettel> {
    const now = Date.now();
    const zettel: Zettel = {
      id: generateId(),
      title: data.title,
      body: data.body,
      tags: data.tags,
      createdAt: now,
      updatedAt: now,
      bodyLen: utf8Length(data.body),
      bodyAt: now,
    };

    await this.repo.create(zettel);
    await this._syncLinks(zettel);
    return zettel;
  }

  /**
   * Só com o corpo local atualizado, ou com um corpo novo em `data`: o push
   * leva o zettel inteiro, e um corpo velho sobrescreveria no servidor a
   * versão feita em outro aparelho.
   */
  async update(id: string, data: Partial<Pick<Zettel, 'title' | 'body' | 'tags'>>): Promise<Zettel> {
    const existing = await this.repo.findById(id);
    if (!existing) throw new Error(`Zettel ${id} not found`);
    if (data.body === undefined && isBodyStale(existing)) throw new StaleBodyError(id);

    const now = Date.now();
    const body = data.body ?? existing.body;
    const updated: Zettel = {
      ...existing,
      ...data,
      body,
      updatedAt: now,
      bodyLen: utf8Length(body),
      bodyAt: now,
    };

    await this.repo.update(updated);
    await this._syncLinks(updated);
    return updated;
  }

  async delete(id: string): Promise<void> {
    return this.repo.delete(id);
  }

  async getBacklinks(id: string): Promise<ZettelMeta[]> {
    return this.repo.getBacklinks(id);
  }

  async getAllLinks(): Promise<Link[]> {
    return this.repo.getAllLinks();
  }

  async clearAll(): Promise<void> {
    return this.repo.clearAll();
  }

  /**
   * Reescreve `[[oldTitle]]` → `[[newTitle]]` nos corpos locais, lidos por
   * cursor. Corpos desatualizados ficam de fora: reescrever a versão velha e
   * enviar apagaria a edição feita em outro aparelho. Quem chama deve baixar
   * os corpos pendentes antes, se houver rede.
   */
  async rewriteLinks(oldTitle: string, newTitle: string, excludeId: string): Promise<RewriteResult> {
    const lowerOld = oldTitle.toLowerCase();
    const candidates: { id: string; body: string }[] = [];
    await this.repo.eachBody((id, body) => {
      if (id === excludeId) return;
      const lowerBody = body.toLowerCase();
      if (!lowerBody.includes(`[[${lowerOld}`) && !lowerBody.includes(`[[^${lowerOld}`)) return;
      const newBody = rewriteLinkTitle(body, oldTitle, newTitle);
      if (newBody !== body) candidates.push({ id, body: newBody });
    });

    const rewritten: Zettel[] = [];
    const skippedStale: string[] = [];
    for (const c of candidates) {
      const existing = await this.repo.findById(c.id);
      if (!existing) continue;
      if (isBodyStale(existing)) {
        skippedStale.push(c.id);
        continue;
      }
      const now = Date.now();
      const updated: Zettel = { ...existing, body: c.body, updatedAt: now, bodyLen: utf8Length(c.body), bodyAt: now };
      await this.repo.update(updated);
      rewritten.push(updated);
    }

    return { rewritten, skippedStale };
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
