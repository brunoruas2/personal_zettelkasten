import type { Zettel, ZettelController } from '@zettelkasten/core';
import { api } from './api';
import { serverZettelToLocal } from './sync';

/**
 * Cadeia de busca única do app: FTS5 do servidor primeiro, busca local do
 * Dexie como fallback quando a requisição falha ou o dispositivo está offline.
 *
 * Não escreve em estado nenhum — recebe o controller, devolve os zettels. É o
 * que permite a `SearchPalette` buscar sem tocar em `useZettelStore.zettels`,
 * enquanto a busca da Sidebar/home continua escrevendo na lista global.
 */
export async function searchZettels(
  controller: ZettelController,
  query: string,
): Promise<Zettel[]> {
  if (!query.trim()) return controller.getAll();

  try {
    const res = await api.get(`/api/zettels?q=${encodeURIComponent(query)}`);
    if (res.ok) {
      const data = await res.json();
      return data.map(serverZettelToLocal);
    }
  } catch {
    // offline ou erro — cai para a busca local
  }

  return controller.search(query);
}
