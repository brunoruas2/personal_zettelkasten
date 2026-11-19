import type { ZettelController, ZettelMeta } from '@zettelkasten/core';
import { api } from './api';
import { serverZettelToMeta } from './sync';
import { useTypesStore } from '../store/useTypesStore';

/** Restringe uma busca a um tipo (id) e/ou a um nível (chave). */
export interface TypeFilterArg {
  typeId?: string;
  level?: string;
}

/**
 * Filtra pelos tipos e níveis do store de tipos. É um filtro de leitura sobre o
 * resultado: não mexe no índice global (`useZettelStore.zettels`). Zettel sem
 * tipo nunca passa por um filtro de tipo ou de nível.
 */
export function applyTypeFilter(zettels: ZettelMeta[], filter: TypeFilterArg | undefined): ZettelMeta[] {
  if (!filter || (!filter.typeId && !filter.level)) return zettels;
  const { assignments } = useTypesStore.getState();
  return zettels.filter((z) => {
    const a = assignments.get(z.id);
    if (!a) return false;
    if (filter.typeId && a.typeId !== filter.typeId) return false;
    if (filter.level && a.level !== filter.level) return false;
    return true;
  });
}

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
  filter?: TypeFilterArg,
): Promise<ZettelMeta[]> {
  return applyTypeFilter(await searchAll(controller, query), filter);
}

async function searchAll(controller: ZettelController, query: string): Promise<ZettelMeta[]> {
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
