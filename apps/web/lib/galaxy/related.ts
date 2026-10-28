import type { Related } from '@zettelkasten/core';

export interface RelatedItem {
  id: string;
  title: string;
  /** Motivo curto, para a prévia: "2 tags em comum · mora perto". */
  reason: string;
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** Motivo em português dos sinais que pesaram, do mais forte ao mais fraco (máx. 2). */
export function describeRelated(r: Related, title: string): RelatedItem {
  const parts: string[] = [];
  if (r.sharedTags > 0) parts.push(`${plural(r.sharedTags, 'tag', 'tags')} em comum`);
  if (r.commonNeighbors > 0) {
    parts.push(r.commonNeighbors === 1 ? 'liga ao mesmo zettel' : `${r.commonNeighbors} ligações em comum`);
  }
  if (r.near) parts.push('mora perto');
  return { id: r.id, title, reason: parts.slice(0, 2).join(' · ') };
}
