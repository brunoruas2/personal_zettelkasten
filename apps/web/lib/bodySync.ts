import { isBodyStale, type BodyEntry, type Zettel } from '@zettelkasten/core';
import { api, AuthError } from './api';
import { repo } from './repo';
import { invalidateBody } from './bodyCache';

/**
 * Segunda fase do sync: o pull traz só o índice; os corpos novos ou
 * desatualizados vêm daqui, em lotes, em background. Um corpo antigo continua
 * legível offline até o novo chegar.
 */

const BATCH = 100;

interface ServerBody {
  id: string;
  body: string;
  updated_at: number;
}

// --- progresso (Settings → Armazenamento) ---

let progress = { fresh: 0, total: 0 };
const progressListeners = new Set<() => void>();

export function getBodyProgress(): { fresh: number; total: number } {
  return progress;
}

export function subscribeBodyProgress(listener: () => void): () => void {
  progressListeners.add(listener);
  return () => progressListeners.delete(listener);
}

function setProgress(fresh: number, total: number): void {
  progress = { fresh, total };
  progressListeners.forEach((l) => l());
}

/** Recalcula o progresso a partir do índice local (sem rede). */
export async function refreshBodyProgress(): Promise<void> {
  const metas = await repo.listMeta();
  setProgress(metas.filter((m) => !isBodyStale(m)).length, metas.length);
}

function idle(): Promise<void> {
  return new Promise((resolve) => {
    if (typeof requestIdleCallback === 'function') requestIdleCallback(() => resolve(), { timeout: 500 });
    else setTimeout(resolve, 50);
  });
}

async function fetchBodies(ids: string[]): Promise<string[]> {
  const res = await api.post('/api/zettels/bodies', { ids });
  if (!res.ok) throw new Error(`API ${res.status}`);
  const list: ServerBody[] = await res.json();
  const entries: BodyEntry[] = list.map((b) => ({ id: b.id, body: b.body, at: b.updated_at }));
  // putBodies só aplica se a versão do servidor não for mais velha que a meta
  // local — uma edição feita aqui depois do pull vence.
  const applied = await repo.putBodies(entries);
  for (const id of applied) invalidateBody(id);
  return applied;
}

let running: Promise<void> | null = null;

/**
 * Baixa todos os corpos desatualizados. Single-flight; para na primeira falha
 * de rede e retoma na próxima rodada (pullAll, online). Cede a thread entre
 * lotes para não travar a UI.
 */
export function downloadBodies(): Promise<void> {
  if (!running) {
    running = doDownload().finally(() => {
      running = null;
    });
  }
  return running;
}

async function doDownload(): Promise<void> {
  const metas = await repo.listMeta();
  const stale = metas.filter(isBodyStale).map((m) => m.id);
  let fresh = metas.length - stale.length;
  setProgress(fresh, metas.length);

  for (let i = 0; i < stale.length; i += BATCH) {
    try {
      fresh += (await fetchBodies(stale.slice(i, i + BATCH))).length;
    } catch (err) {
      if (err instanceof AuthError) throw err;
      return; // rede — retoma na próxima rodada
    }
    setProgress(fresh, metas.length);
    await idle();
  }
}

/**
 * Zettel para abrir: se o corpo local estiver desatualizado e houver rede,
 * busca esse corpo na hora. `stale` = continua desatualizado (offline); quem
 * edita precisa bloquear o salvar.
 */
export async function loadZettel(id: string): Promise<{ zettel: Zettel | null; stale: boolean }> {
  let zettel = await repo.findById(id);
  if (zettel && isBodyStale(zettel)) {
    try {
      await fetchBodies([id]);
      zettel = await repo.findById(id);
      void refreshBodyProgress();
    } catch (err) {
      if (err instanceof AuthError) throw err;
      // offline — devolve o que há
    }
  }
  return { zettel, stale: zettel ? isBodyStale(zettel) : false };
}

/** Corpo ausente: nunca baixado neste aparelho (nada para mostrar offline). */
export function isBodyMissing(z: Pick<Zettel, 'bodyAt'>): boolean {
  return z.bodyAt === null;
}
