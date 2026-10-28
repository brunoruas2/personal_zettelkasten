'use client';

import { useMemo } from 'react';
import type { Link, ZettelMeta } from '@zettelkasten/core';
import { useZettelStore } from '../store/useZettelStore';

const collator = new Intl.Collator('pt-BR', { sensitivity: 'base' });

export interface LinkIndex {
  /** Zettels que o corpo de `id` cita (source → target), ordenados por título. */
  outgoing: (id: string) => ZettelMeta[];
  /** Zettels que citam `id` (backlinks), ordenados por título. */
  incoming: (id: string) => ZettelMeta[];
  /** Vizinhos por link sem direção (saídas ∪ entradas), só ids e sem ordem. */
  neighbors: (id: string) => string[];
}

/** Constrói os dois mapas (saídas e entradas) a partir da tabela de links. */
export function buildLinkIndex(links: Link[], zettels: ZettelMeta[]): LinkIndex {
  const byId = new Map(zettels.map((z) => [z.id, z]));
  const out = new Map<string, Set<string>>();
  const inc = new Map<string, Set<string>>();
  for (const l of links) {
    if (l.sourceId === l.targetId) continue;
    if (!byId.has(l.sourceId) || !byId.has(l.targetId)) continue;
    (out.get(l.sourceId) ?? out.set(l.sourceId, new Set()).get(l.sourceId)!).add(l.targetId);
    (inc.get(l.targetId) ?? inc.set(l.targetId, new Set()).get(l.targetId)!).add(l.sourceId);
  }
  const resolve = (m: Map<string, Set<string>>) => (id: string) => {
    const set = m.get(id);
    if (!set) return [];
    return [...set]
      .map((x) => byId.get(x)!)
      .sort((a, b) => collator.compare(a.title || 'Sem título', b.title || 'Sem título'));
  };
  const neighbors = (id: string): string[] => {
    const a = out.get(id);
    const b = inc.get(id);
    if (!a) return b ? [...b] : [];
    if (!b) return [...a];
    return [...new Set([...a, ...b])];
  };
  return { outgoing: resolve(out), incoming: resolve(inc), neighbors };
}

/**
 * Índice de links derivado uma vez por mudança em `links`/índice — cards,
 * leitor e editor leem daqui; ninguém consulta o banco por render.
 */
export function useLinkIndex(): LinkIndex {
  const links = useZettelStore((s) => s.links);
  const zettels = useZettelStore((s) => s.zettels);
  return useMemo(() => sharedIndex(links, zettels), [links, zettels]);
}

// Cada card monta o seu rodapé: o índice é construído uma vez por par de
// referências (`links`, `zettels`) e compartilhado entre todos.
let cache: { links: Link[]; zettels: ZettelMeta[]; index: LinkIndex } | null = null;

function sharedIndex(links: Link[], zettels: ZettelMeta[]): LinkIndex {
  if (cache && cache.links === links && cache.zettels === zettels) return cache.index;
  const index = buildLinkIndex(links, zettels);
  cache = { links, zettels, index };
  return index;
}
