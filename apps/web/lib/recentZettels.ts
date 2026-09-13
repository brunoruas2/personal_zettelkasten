const RECENT_KEY = 'zettel_recent';

/**
 * Ids dos últimos zettels visitados, do mais recente para o mais antigo.
 *
 * A chave é escrita em `/zettel/[id]/page.tsx` a cada visita. A leitura tolera
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
