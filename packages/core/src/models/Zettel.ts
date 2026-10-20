/**
 * Metadados de um zettel — o que fica em memória para a base inteira. O corpo
 * mora numa tabela própria e é lido sob demanda: com 100k+ zettels, manter
 * todos os corpos no heap estoura um celular.
 */
export interface ZettelMeta {
  id: string;
  title: string;
  tags: string[];
  createdAt: number;
  updatedAt: number;
  /** Tamanho do corpo em bytes UTF-8. */
  bodyLen: number;
  /**
   * `updatedAt` da versão do corpo guardada neste aparelho; `null` = nunca
   * baixado. Menor que `updatedAt` = o pull trouxe uma meta mais nova e o
   * corpo novo ainda não chegou (o antigo continua legível).
   */
  bodyAt: number | null;
}

/** Zettel completo: meta + corpo. É o que trafega ao abrir, criar e salvar. */
export interface Zettel extends ZettelMeta {
  body: string;
}

/** Linha da tabela `zettels` no IndexedDB — só metadados. */
export interface ZettelRow {
  id: string;
  title: string;
  tags: string; // JSON string
  created_at: number;
  updated_at: number;
  body_len: number;
  body_at: number | null;
}

/** O corpo local está ausente ou é de uma versão anterior à da meta. */
export function isBodyStale(meta: Pick<ZettelMeta, 'updatedAt' | 'bodyAt'>): boolean {
  return meta.bodyAt === null || meta.bodyAt < meta.updatedAt;
}

/** Bytes UTF-8 de `str`, sem depender de `TextEncoder`. */
export function utf8Length(str: string): number {
  let n = 0;
  for (let i = 0; i < str.length; i++) {
    const c = str.charCodeAt(i);
    if (c < 0x80) n += 1;
    else if (c < 0x800) n += 2;
    else if (c >= 0xd800 && c <= 0xdbff && i + 1 < str.length) {
      const d = str.charCodeAt(i + 1);
      if (d >= 0xdc00 && d <= 0xdfff) {
        n += 4;
        i++;
      } else {
        n += 3;
      }
    } else n += 3;
  }
  return n;
}

export function rowToMeta(row: ZettelRow): ZettelMeta {
  return {
    id: row.id,
    title: row.title,
    tags: JSON.parse(row.tags || '[]'),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    bodyLen: row.body_len ?? 0,
    bodyAt: row.body_at ?? null,
  };
}

export function metaToRow(meta: ZettelMeta): ZettelRow {
  return {
    id: meta.id,
    title: meta.title,
    tags: JSON.stringify(meta.tags),
    created_at: meta.createdAt,
    updated_at: meta.updatedAt,
    body_len: meta.bodyLen,
    body_at: meta.bodyAt,
  };
}

/** Descarta o corpo — o que entra na lista global. */
export function toMeta(z: ZettelMeta): ZettelMeta {
  return {
    id: z.id,
    title: z.title,
    tags: z.tags,
    createdAt: z.createdAt,
    updatedAt: z.updatedAt,
    bodyLen: z.bodyLen,
    bodyAt: z.bodyAt,
  };
}

/** Corpo vindo do servidor, com a versão a que pertence. */
export interface BodyEntry {
  id: string;
  body: string;
  /** `updated_at` do zettel no servidor quando o corpo foi lido. */
  at: number;
}
