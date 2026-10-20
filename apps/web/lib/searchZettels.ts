import type { ZettelController, ZettelMeta } from '@zettelkasten/core';
import { api } from './api';
import { serverZettelToMeta } from './sync';

/**
 * Cadeia de busca única do app: FTS5 do servidor primeiro, busca local
 * híbrida (título/tags pelo índice + corpo por cursor) como fallback quando a
 * requisição falha ou o dispositivo está offline.
 *
 * Devolve só metadados: o corpo que o servidor manda junto é descartado, a
 * lista global não guarda corpos.
 *
 * Não escreve em estado nenhum — recebe o controller, devolve os zettels. É o
 * que permite a busca da galáxia buscar sem tocar em `useZettelStore.zettels`
 * (o índice que a galáxia desenha).
 */
export async function searchZettels(
  controller: ZettelController,
  query: string,
): Promise<ZettelMeta[]> {
  if (!query.trim()) return controller.getAll();

  try {
    const res = await api.get(`/api/zettels?q=${encodeURIComponent(query)}`);
    if (res.ok) {
      const data = await res.json();
      return data.map(serverZettelToMeta);
    }
  } catch {
    // offline ou erro — cai para a busca local
  }

  return controller.search(query);
}
