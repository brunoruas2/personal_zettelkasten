import { describe, expect, it } from 'vitest';
import type { BodyEntry, Zettel, ZettelMeta } from '../models/Zettel';
import { isBodyStale, utf8Length } from '../models/Zettel';
import type { Link } from '../models/Link';
import { StaleBodyError, ZettelController, type ZettelRepository } from './ZettelController';

/** Repositório em memória com meta e corpo separados, como o Dexie. */
class MemoryRepo implements ZettelRepository {
  metas = new Map<string, ZettelMeta>();
  bodies = new Map<string, string>();
  links: Link[] = [];

  async listMeta() {
    return [...this.metas.values()];
  }
  async findById(id: string): Promise<Zettel | null> {
    const m = this.metas.get(id);
    return m ? { ...m, body: this.bodies.get(id) ?? '' } : null;
  }
  async findByTitle(title: string) {
    return [...this.metas.values()].find((m) => m.title.toLowerCase() === title.toLowerCase()) ?? null;
  }
  async getBody(id: string) {
    return this.bodies.get(id) ?? null;
  }
  async getBodies(ids: string[]) {
    const out = new Map<string, string>();
    for (const id of ids) if (this.bodies.has(id)) out.set(id, this.bodies.get(id)!);
    return out;
  }
  async eachBody(cb: (id: string, body: string) => void) {
    for (const [id, body] of this.bodies) cb(id, body);
  }
  async searchBodies(query: string, limit: number, skip: Set<string>) {
    const out: string[] = [];
    for (const [id, body] of this.bodies) {
      if (out.length >= limit) break;
      if (!skip.has(id) && body.toLowerCase().includes(query)) out.push(id);
    }
    return out;
  }
  async putBodies(entries: BodyEntry[]) {
    const applied: string[] = [];
    for (const e of entries) {
      const m = this.metas.get(e.id);
      if (!m || e.at < m.updatedAt) continue;
      this.bodies.set(e.id, e.body);
      this.metas.set(e.id, { ...m, bodyAt: e.at, bodyLen: utf8Length(e.body) });
      applied.push(e.id);
    }
    return applied;
  }
  async upsertMeta(metas: Omit<ZettelMeta, 'bodyAt'>[]) {
    for (const m of metas) this.metas.set(m.id, { ...m, bodyAt: this.metas.get(m.id)?.bodyAt ?? null });
  }
  async create(z: Zettel) {
    const { body, ...meta } = z;
    this.metas.set(z.id, meta);
    this.bodies.set(z.id, body);
  }
  async update(z: Zettel) {
    await this.create(z);
  }
  async delete(id: string) {
    this.metas.delete(id);
    this.bodies.delete(id);
  }
  async getBacklinks() {
    return [];
  }
  async upsertLinks(sourceId: string, links: Link[]) {
    this.links = [...this.links.filter((l) => l.sourceId !== sourceId), ...links];
  }
  async replaceAllLinks(links: Link[]) {
    this.links = links;
  }
  async getAllLinks() {
    return this.links;
  }
  async clearAll() {
    this.metas.clear();
    this.bodies.clear();
  }
}

function setup() {
  const repo = new MemoryRepo();
  return { repo, ctl: new ZettelController(repo) };
}

describe('utf8Length / isBodyStale', () => {
  it('conta bytes UTF-8 com acento e emoji', () => {
    expect(utf8Length('abc')).toBe(3);
    expect(utf8Length('ação')).toBe(6);
    expect(utf8Length('😀')).toBe(4);
    expect(utf8Length('€')).toBe(3);
  });

  it('corpo ausente ou mais velho que a meta está desatualizado', () => {
    expect(isBodyStale({ updatedAt: 10, bodyAt: null })).toBe(true);
    expect(isBodyStale({ updatedAt: 10, bodyAt: 9 })).toBe(true);
    expect(isBodyStale({ updatedAt: 10, bodyAt: 10 })).toBe(false);
  });
});

describe('ZettelController', () => {
  it('create preenche bodyLen e bodyAt', async () => {
    const { ctl } = setup();
    const z = await ctl.create({ title: 't', body: 'ação', tags: [] });
    expect(z.bodyLen).toBe(6);
    expect(z.bodyAt).toBe(z.updatedAt);
  });

  it('getAll devolve só metadados', async () => {
    const { ctl } = setup();
    await ctl.create({ title: 't', body: 'corpo', tags: [] });
    const [m] = await ctl.getAll();
    expect('body' in m).toBe(false);
  });

  it('busca híbrida: título, depois tag, depois só corpo, sem duplicatas', async () => {
    const { ctl } = setup();
    await ctl.create({ title: 'Corpo', body: 'nada', tags: [] });
    await ctl.create({ title: 'b', body: 'nada', tags: ['corpo-tag'] });
    await ctl.create({ title: 'c', body: 'fala de corpo aqui', tags: [] });
    await ctl.create({ title: 'Corpo duplo', body: 'corpo de novo', tags: [] });
    await ctl.create({ title: 'd', body: 'outra coisa', tags: [] });
    const titles = (await ctl.search('corpo')).map((m) => m.title);
    expect(titles).toEqual(['Corpo', 'Corpo duplo', 'b', 'c']);
  });

  it('update sem corpo novo recusa corpo desatualizado', async () => {
    const { repo, ctl } = setup();
    const z = await ctl.create({ title: 't', body: 'v1', tags: [] });
    await repo.upsertMeta([{ ...z, updatedAt: z.updatedAt + 100 }]);
    await expect(ctl.update(z.id, { title: 'novo' })).rejects.toBeInstanceOf(StaleBodyError);
  });

  it('rewriteLinks reescreve só corpos atualizados', async () => {
    const { repo, ctl } = setup();
    const a = await ctl.create({ title: 'a', body: 'veja [[Velho]]', tags: [] });
    const b = await ctl.create({ title: 'b', body: 'também [[Velho]]', tags: [] });
    // b mudou em outro aparelho e o corpo novo ainda não chegou.
    await repo.upsertMeta([{ ...b, updatedAt: b.updatedAt + 100 }]);

    const res = await ctl.rewriteLinks('Velho', 'Novo', 'nenhum');
    expect(res.rewritten.map((z) => z.id)).toEqual([a.id]);
    expect(res.skippedStale).toEqual([b.id]);
    expect(await repo.getBody(a.id)).toBe('veja [[Novo]]');
    expect(await repo.getBody(b.id)).toBe('também [[Velho]]');
  });
});
