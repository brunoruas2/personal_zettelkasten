import type { ZettelType } from '../models/ZettelType';
import type { Link } from '../models/Link';
import { effectiveLevel } from './TypeRules';

/**
 * Maturidade de um zettel a partir do tipo e do nível: o que o Mapa e o HUD
 * desenham. Funções puras (sem browser), testadas em Vitest.
 */

/**
 * Fração da escada já percorrida, em (0, 1]: `(posição + 1) / total de
 * níveis`. `null` = sem nível (sem tipo, tipo sem escada ou nível que o tipo
 * não declara mais). Escada de um nível vale 1.
 */
export function levelFraction(
  type: Pick<ZettelType, 'levels'> | null | undefined,
  levelKey: string | null | undefined,
): number | null {
  if (!type || !levelKey || type.levels.length === 0) return null;
  const i = type.levels.findIndex((l) => l.key === levelKey);
  if (i < 0) return null;
  return (i + 1) / type.levels.length;
}

/** Agrupa a fração (0, 1] em `buckets` faixas de granulação: 0 = esparsa … buckets − 1 = sólida. */
export function levelBucket(fraction: number, buckets = 4): number {
  if (buckets <= 1) return 0;
  const i = Math.ceil(fraction * buckets) - 1;
  return Math.min(buckets - 1, Math.max(0, i));
}

export interface AssignmentLike {
  typeId: string;
  level: string | null;
}

export interface LevelCount {
  key: string;
  label: string;
  emoji?: string;
  count: number;
}

/** Contagem por nível de um tipo que conta no progresso. */
export interface LevelGroup {
  type: ZettelType;
  /** Na ordem da escada, com zero nos níveis sem zettel. Vazio se o tipo não tem escada. */
  levels: LevelCount[];
  /** Zettels do tipo sem nível (tipo com escada). */
  noLevel: number;
  total: number;
}

export interface LevelSummary {
  groups: LevelGroup[];
  total: number;
}

/**
 * Conta os zettels de `ids` por tipo e nível, só dos tipos com
 * `countsProgress`. Teste, Fonte, Prática, zettel sem tipo e tipo que não
 * conta ficam de fora. `includeEmptyTypes` mostra também os tipos que contam
 * sem nenhum zettel (a caixa da base inteira); sem ele, só os que aparecem
 * (progresso de uma trilha). Um tipo sem escada só tem `total`.
 */
export function summarizeLevels(
  ids: Iterable<string>,
  assignments: ReadonlyMap<string, AssignmentLike>,
  typeById: ReadonlyMap<string, ZettelType>,
  opts: { includeEmptyTypes?: boolean } = {},
): LevelSummary {
  const groups = new Map<string, LevelGroup>();
  const group = (t: ZettelType): LevelGroup => {
    let g = groups.get(t.id);
    if (!g) {
      g = { type: t, levels: t.levels.map((l) => ({ key: l.key, label: l.label, emoji: l.emoji, count: 0 })), noLevel: 0, total: 0 };
      groups.set(t.id, g);
    }
    return g;
  };
  if (opts.includeEmptyTypes) {
    for (const t of typeById.values()) if (t.countsProgress) group(t);
  }
  let total = 0;
  const seen = new Set<string>();
  for (const id of ids) {
    if (seen.has(id)) continue;
    seen.add(id);
    const a = assignments.get(id);
    const t = a ? typeById.get(a.typeId) : undefined;
    if (!a || !t || !t.countsProgress) continue;
    const g = group(t);
    g.total++;
    total++;
    if (t.levels.length === 0) continue;
    const key = effectiveLevel(t, a.level);
    const slot = key ? g.levels.find((l) => l.key === key) : undefined;
    if (slot) slot.count++;
    else g.noLevel++;
  }
  return { groups: [...groups.values()], total };
}

/**
 * Ids que uma trilha cita: links de saída comuns, sem o link de pai
 * (`parent-ref`, que aponta para o pai da própria trilha), sem duplicata. É a
 * mesma regra da tool `trail_progress` do MCP.
 */
export function trailLinkedIds(links: ReadonlyArray<Link>, trailId: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const l of links) {
    if (l.sourceId !== trailId || l.targetId === trailId || l.type === 'parent-ref') continue;
    if (seen.has(l.targetId)) continue;
    seen.add(l.targetId);
    out.push(l.targetId);
  }
  return out;
}

/** Progresso de uma trilha: o estado dos conteúdos que ela cita. */
export function trailProgress(
  links: ReadonlyArray<Link>,
  trailId: string,
  assignments: ReadonlyMap<string, AssignmentLike>,
  typeById: ReadonlyMap<string, ZettelType>,
): LevelSummary {
  return summarizeLevels(trailLinkedIds(links, trailId), assignments, typeById);
}
