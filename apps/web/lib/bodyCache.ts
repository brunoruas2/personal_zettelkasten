/**
 * Cache LRU dos corpos em memória, com teto por bytes (soma de `bodyLen`). Os
 * corpos moram no IndexedDB; aqui fica só o que foi lido para exibição
 * recentemente — com 100k+ zettels, nada pode manter todos no heap.
 */
const MAX_BYTES = 8 * 1024 * 1024;

interface Entry {
  body: string;
  bytes: number;
}

// `Map` preserva a ordem de inserção: reinserir na leitura = mais recente no fim.
const entries = new Map<string, Entry>();
let total = 0;

const listeners = new Map<string, Set<() => void>>();

export function getCachedBody(id: string): string | undefined {
  const e = entries.get(id);
  if (!e) return undefined;
  entries.delete(id);
  entries.set(id, e);
  return e.body;
}

export function setCachedBody(id: string, body: string, bytes: number): void {
  const old = entries.get(id);
  if (old) {
    total -= old.bytes;
    entries.delete(id);
  }
  // Um corpo maior que o teto inteiro não entra — seria expulso na hora.
  if (bytes <= MAX_BYTES) {
    entries.set(id, { body, bytes });
    total += bytes;
    for (const [key, e] of entries) {
      if (total <= MAX_BYTES) break;
      entries.delete(key);
      total -= e.bytes;
    }
  }
  emit(id);
}

/** O corpo mudou (download, edição) ou sumiu (exclusão): descarta e avisa quem exibe. */
export function invalidateBody(id: string): void {
  const old = entries.get(id);
  if (old) {
    total -= old.bytes;
    entries.delete(id);
  }
  emit(id);
}

export function clearBodyCache(): void {
  entries.clear();
  total = 0;
}

export function subscribeBody(id: string, listener: () => void): () => void {
  let set = listeners.get(id);
  if (!set) {
    set = new Set();
    listeners.set(id, set);
  }
  set.add(listener);
  return () => {
    set.delete(listener);
    if (set.size === 0) listeners.delete(id);
  };
}

function emit(id: string): void {
  listeners.get(id)?.forEach((l) => l());
}
