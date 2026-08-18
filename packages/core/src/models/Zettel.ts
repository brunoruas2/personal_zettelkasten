export interface Zettel {
  id: string;
  title: string;
  body: string;
  tags: string[];
  createdAt: number;
  updatedAt: number;
}

export interface ZettelRow {
  id: string;
  title: string;
  body: string;
  tags: string; // JSON string
  created_at: number;
  updated_at: number;
}

export function rowToZettel(row: ZettelRow): Zettel {
  return {
    id: row.id,
    title: row.title,
    body: row.body,
    tags: JSON.parse(row.tags || '[]'),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function zettelToRow(zettel: Zettel): ZettelRow {
  return {
    id: zettel.id,
    title: zettel.title,
    body: zettel.body,
    tags: JSON.stringify(zettel.tags),
    created_at: zettel.createdAt,
    updated_at: zettel.updatedAt,
  };
}
