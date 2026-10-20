const RECENT_KEY = 'zettel_recent';

/**
 * Ids dos últimos zettels visitados, do mais recente para o mais antigo.
 *
 * A chave é escrita pela galáxia (`pushRecent`) ao voar até um zettel ou
 * entrar em edição. A leitura tolera
 * falha de acesso ao localStorage (modo privado, site data bloqueado) e JSON
 * corrompido devolvendo lista vazia — quem chama trata isso como "sem
 * histórico", não como erro.
 */
export function getRecentIds(): string[] {
  try {
    const raw = localStorage.getItem(RECENT_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((x): x is string => typeof x === 'string');
  } catch {
    return [];
  }
}

const RECENT_LIMIT = 20;

/** Registra `id` como o visitado mais recente (por dispositivo, não sincroniza). */
export function pushRecent(id: string): void {
  try {
    const next = [id, ...getRecentIds().filter((x) => x !== id)].slice(0, RECENT_LIMIT);
    localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch {
    // localStorage indisponível — fica sem histórico
  }
}
