import { isTypeColor, isTypeIcon } from './TypeAppearance';

/** Limites impostos no servidor e no formulário (mesmos números em Go). */
export const MAX_TYPES = 50;
export const MAX_LEVELS = 12;
export const MAX_PROTECTED_SECTIONS = 8;
export const MAX_TEMPLATE_BYTES = 16 * 1024;
export const MAX_TYPE_NAME = 60;

/** Um degrau da escada de maturidade de um tipo. A ordem do array é a escada. */
export interface TypeLevel {
  /** Slug estável: nunca muda depois de criado. */
  key: string;
  label: string;
  emoji?: string;
  /** Só o usuário (origem `ui`) atribui ou desfaz este nível. */
  userOnly: boolean;
}

/** Tipo de zettel cadastrado pelo usuário. */
export interface ZettelType {
  id: string;
  name: string;
  /** Único entre os tipos vivos do usuário. */
  slug: string;
  icon: string;
  color: string;
  /** Corpo inicial (Markdown literal, sem variáveis). */
  template: string;
  /** Títulos de seção que só o usuário escreve (sem diferenciar caixa). */
  protectedSections: string[];
  /** Escada de maturidade; vazio = o tipo não tem níveis. */
  levels: TypeLevel[];
  /** Os zettels deste tipo medem o progresso de uma trilha. */
  countsProgress: boolean;
  /** Relógio do cliente: decide o LWW. */
  updatedAt: number;
  deletedAt?: number | null;
}

/** Tipo e nível de um zettel. O id é o do próprio zettel. */
export interface TypeAssignment {
  zettelId: string;
  typeId: string;
  /** `key` de um nível do tipo; `null` = sem nível. */
  level: string | null;
  updatedAt: number;
  deletedAt?: number | null;
}

const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,39}$/;

/** Nome → slug (minúsculas, sem acento, hífen). */
export function slugify(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/g, '');
}

export function isValidSlug(slug: string): boolean {
  return SLUG_RE.test(slug);
}

function byteLength(s: string): number {
  return new TextEncoder().encode(s).length;
}

/**
 * Valida a forma de um tipo (não a unicidade do slug nem o teto de tipos, que
 * dependem do conjunto). Devolve as mensagens de erro; vazio = válido.
 */
export function validateType(t: Pick<ZettelType, 'name' | 'slug' | 'icon' | 'color' | 'template' | 'protectedSections' | 'levels'>): string[] {
  const errors: string[] = [];
  const name = t.name.trim();
  if (!name) errors.push('o nome é obrigatório');
  if (name.length > MAX_TYPE_NAME) errors.push(`o nome passa de ${MAX_TYPE_NAME} caracteres`);
  if (!isValidSlug(t.slug)) errors.push('o slug é inválido (minúsculas, números e hífen)');
  if (!isTypeIcon(t.icon)) errors.push('o ícone não está na lista permitida');
  if (!isTypeColor(t.color)) errors.push('a cor não está na paleta permitida');
  if (byteLength(t.template) > MAX_TEMPLATE_BYTES) errors.push('o template passa de 16 KB');
  if (t.protectedSections.length > MAX_PROTECTED_SECTIONS) {
    errors.push(`no máximo ${MAX_PROTECTED_SECTIONS} seções protegidas`);
  }
  if (t.protectedSections.some((s) => !s.trim())) errors.push('seção protegida sem título');
  if (t.levels.length > MAX_LEVELS) errors.push(`no máximo ${MAX_LEVELS} níveis`);
  const keys = new Set<string>();
  for (const l of t.levels) {
    if (!isValidSlug(l.key)) errors.push(`a chave do nível "${l.label}" é inválida`);
    if (keys.has(l.key)) errors.push(`o nível "${l.key}" está repetido`);
    keys.add(l.key);
    if (!l.label.trim()) errors.push(`o nível "${l.key}" não tem rótulo`);
  }
  return errors;
}

// --- Registros locais (IndexedDB) e forma no servidor (`/api/types`) ---

export type TypeSyncState = 'pending' | 'synced' | 'rejected';

/**
 * Tipo guardado no IndexedDB. `syncState` é a própria fila de envio, como nos
 * desenhos. `deletedAt` marca o tipo apagado (tombstone): continua na tabela
 * até o servidor confirmar, e some das listas da UI.
 */
export interface TypeRecord extends ZettelType {
  syncState: TypeSyncState;
}

/** Atribuição guardada no IndexedDB; o `id` é o do zettel. */
export interface AssignmentRecord {
  id: string;
  typeId: string;
  level: string | null;
  updatedAt: number;
  /** Preenchido = "sem tipo" (tombstone), à espera de confirmação ou já confirmado. */
  deletedAt: number | null;
  syncState: TypeSyncState;
}

/** Forma de um tipo no servidor (timestamps em ms, snake_case). */
export interface ServerType {
  id: string;
  name: string;
  slug: string;
  icon: string;
  color: string;
  template: string;
  protected_sections: string[];
  levels: { key: string; label: string; emoji?: string; user_only: boolean }[];
  counts_progress: boolean;
  updated_at: number;
  deleted_at?: number | null;
}

/** Forma de uma atribuição no servidor; `level` vazio = sem nível. */
export interface ServerAssignment {
  zettel_id: string;
  type_id: string;
  level: string;
  updated_at: number;
  deleted_at?: number | null;
}

export function serverTypeToType(s: ServerType): ZettelType {
  return {
    id: s.id,
    name: s.name,
    slug: s.slug,
    icon: s.icon,
    color: s.color,
    template: s.template ?? '',
    protectedSections: s.protected_sections ?? [],
    levels: (s.levels ?? []).map((l) => ({
      key: l.key,
      label: l.label,
      ...(l.emoji ? { emoji: l.emoji } : {}),
      userOnly: !!l.user_only,
    })),
    countsProgress: !!s.counts_progress,
    updatedAt: s.updated_at,
    deletedAt: s.deleted_at ?? null,
  };
}

export function typeToServer(t: ZettelType): ServerType {
  return {
    id: t.id,
    name: t.name.trim(),
    slug: t.slug,
    icon: t.icon,
    color: t.color,
    template: t.template,
    protected_sections: t.protectedSections,
    levels: t.levels.map((l) => ({ key: l.key, label: l.label, ...(l.emoji ? { emoji: l.emoji } : {}), user_only: l.userOnly })),
    counts_progress: t.countsProgress,
    updated_at: t.updatedAt,
  };
}

export function serverAssignmentToRecord(s: ServerAssignment): AssignmentRecord {
  return {
    id: s.zettel_id,
    typeId: s.type_id,
    level: s.level ? s.level : null,
    updatedAt: s.updated_at,
    deletedAt: s.deleted_at ?? null,
    syncState: 'synced',
  };
}

export function assignmentToServer(a: AssignmentRecord): ServerAssignment {
  return {
    zettel_id: a.id,
    type_id: a.typeId,
    level: a.level ?? '',
    updated_at: a.updatedAt,
    ...(a.deletedAt ? { deleted_at: a.deletedAt } : {}),
  };
}

/** Os tipos vivos, por nome (pt-BR, sem diferenciar caixa). */
export function liveTypes<T extends Pick<ZettelType, 'name' | 'deletedAt'>>(all: T[]): T[] {
  return all.filter((t) => !t.deletedAt).sort((a, b) => a.name.localeCompare(b.name, 'pt-BR', { sensitivity: 'base' }));
}
