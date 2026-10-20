import type { Zettel } from '../models/Zettel';

export interface SearchResult {
  zettel: Zettel;
  snippet?: string;
}

/**
 * Client-side fuzzy filter for autocomplete (used before DB query resolves).
 * The actual FTS5 search runs in packages/db via SQLite.
 */
export function fuzzyFilter<T extends Pick<Zettel, 'title' | 'tags'>>(zettels: T[], query: string): T[] {
  const q = query.toLowerCase().trim();
  if (!q) return zettels;

  return zettels.filter(
    (z) =>
      z.title.toLowerCase().includes(q) ||
      z.tags.some((t) => t.toLowerCase().includes(q)),
  );
}
