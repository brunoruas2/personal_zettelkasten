import { TypeStore, AssignmentStore } from '@zettelkasten/db-web'
import {
  MAX_TYPES,
  assignmentToServer,
  generateId,
  isValidSlug,
  levelAfterTypeChange,
  serverAssignmentToRecord,
  serverTypeToType,
  slugify,
  typeToServer,
  validateLevel,
  validateType,
  type AssignmentRecord,
  type ServerAssignment,
  type ServerType,
  type TypeLevel,
  type TypeRecord,
  type ZettelType,
} from '@zettelkasten/core'
import { api, AuthError } from './api'

/**
 * Tipos de zettel e atribuição de tipo/nível. Tabelas próprias no IndexedDB e
 * no servidor, no molde de `positionSync.ts`: mudar o nível de um zettel nunca
 * toca na linha do zettel (nada de FTS, `updated_at` nem corpo stale).
 * `updatedAt` é o relógio do cliente e decide o LWW; o cursor do delta é o
 * `server_time` devolvido pelo servidor.
 */
export const typeStore = new TypeStore()
export const assignmentStore = new AssignmentStore()

const TYPES_SINCE_KEY = 'zettel_types_since'
const ASSIGN_SINCE_KEY = 'zettel_type_assignments_since'
const PUSH_BATCH = 100

/** Chaves de `localStorage` dos tipos — o logout as remove. */
export const TYPE_STORAGE_KEYS = [TYPES_SINCE_KEY, ASSIGN_SINCE_KEY]

// Avisa o store e a UI quando tipos ou atribuições locais mudam.
const listeners = new Set<() => void>()

export function subscribeTypes(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function emitChanged(): void {
  listeners.forEach((l) => l())
}

function readNum(key: string): number | null {
  try {
    const raw = localStorage.getItem(key)
    if (raw === null) return null
    const n = Number(raw)
    return Number.isFinite(n) ? n : null
  } catch {
    return null
  }
}

function writeNum(key: string, value: number): void {
  try {
    localStorage.setItem(key, String(value))
  } catch {
    // localStorage indisponível — o próximo pull só traz mais do que precisa.
  }
}

/** Tempo para a próxima escrita: agora, mas sempre estritamente depois da anterior. */
function nextAt(prev?: number): number {
  const now = Date.now()
  return prev !== undefined && now <= prev ? prev + 1 : now
}

// --- pull ---

/**
 * Pull delta dos tipos. Servidor vence quando é estritamente mais novo; um
 * `pending` local mais novo fica e será reenviado; apagar é definitivo.
 * Devolve `false` se não deu para falar com o servidor (offline, servidor
 * antigo sem a rota).
 */
export async function pullTypes(): Promise<boolean> {
  try {
    let since = readNum(TYPES_SINCE_KEY) ?? 0
    // IndexedDB apagado com o cursor sobrevivendo no localStorage: o delta
    // nunca traria o que já foi baixado antes.
    if (since > 0 && (await typeStore.count()) === 0) since = 0

    const res = await api.get(`/api/types?since=${since}`)
    if (!res.ok) return false
    const data: { types: ServerType[]; server_time: number } = await res.json()

    if (data.types.length > 0) {
      const local = new Map((await typeStore.getAll()).map((r) => [r.id, r]))
      const next: TypeRecord[] = []
      for (const s of data.types) {
        const cur = local.get(s.id)
        const incoming: TypeRecord = { ...serverTypeToType(s), syncState: 'synced' }
        if (s.deleted_at) {
          if (!cur?.deletedAt || cur.syncState !== 'synced') next.push(incoming)
          continue
        }
        if (cur?.deletedAt) continue
        if (cur && cur.syncState === 'pending' && cur.updatedAt >= s.updated_at) continue
        if (cur && cur.updatedAt > s.updated_at) continue
        next.push(incoming)
      }
      await typeStore.putMany(next)
      if (next.length > 0) emitChanged()
    }
    writeNum(TYPES_SINCE_KEY, data.server_time)
    return true
  } catch (err) {
    if (err instanceof AuthError) throw err
    return false
  }
}

/** Pull delta das atribuições (depois dos tipos e dos zettels). */
export async function pullAssignments(): Promise<boolean> {
  try {
    let since = readNum(ASSIGN_SINCE_KEY) ?? 0
    if (since > 0 && (await assignmentStore.count()) === 0) since = 0

    const res = await api.get(`/api/type-assignments?since=${since}`)
    if (!res.ok) return false
    const data: { assignments: ServerAssignment[]; server_time: number } = await res.json()

    if (data.assignments.length > 0) {
      const local = new Map((await assignmentStore.getAll()).map((r) => [r.id, r]))
      const next: AssignmentRecord[] = []
      for (const s of data.assignments) {
        const cur = local.get(s.zettel_id)
        const incoming = serverAssignmentToRecord(s)
        // O tombstone de um tipo apagado não carrega `updated_at` novo: vale,
        // salvo uma escolha local mais nova ainda não enviada.
        if (cur && cur.syncState === 'pending' && cur.updatedAt >= s.updated_at) continue
        if (cur && cur.updatedAt > s.updated_at) continue
        if (
          cur &&
          cur.syncState === 'synced' &&
          cur.typeId === incoming.typeId &&
          cur.level === incoming.level &&
          (cur.deletedAt === null) === (incoming.deletedAt === null)
        ) {
          continue
        }
        next.push(incoming)
      }
      await assignmentStore.putMany(next)
      if (next.length > 0) emitChanged()
    }
    writeNum(ASSIGN_SINCE_KEY, data.server_time)
    return true
  } catch (err) {
    if (err instanceof AuthError) throw err
    return false
  }
}

/** Tipos e depois atribuições: a atribuição só vale com o tipo já conhecido. */
export async function pullTypesAndAssignments(): Promise<boolean> {
  const types = await pullTypes()
  const assignments = await pullAssignments()
  return types && assignments
}

// --- push ---

let pushing: Promise<void> | null = null

/**
 * Envia tipos e atribuições pendentes (tipos primeiro: a atribuição exige o
 * tipo no servidor). Rede, 5xx e servidor sem a rota (404/405) deixam tudo
 * pendente para a próxima rodada; 4xx é permanente e marca `rejected`.
 * `skipped` = o zettel ainda não chegou ao servidor (sobe pela outra fila).
 */
export function pushPendingTypes(): Promise<void> {
  if (!pushing) {
    pushing = doPush().finally(() => {
      pushing = null
    })
  }
  return pushing
}

const transient = (status: number) => status === 404 || status === 405 || status >= 500

async function doPush(): Promise<void> {
  try {
    // Tipos, um por vez: um inválido não pode travar os outros.
    for (const t of await typeStore.listPending()) {
      if (t.deletedAt) {
        const res = await api.delete(`/api/types/${t.id}`)
        // 404 com JSON = o tipo já não existe no servidor; sem rota = servidor
        // antigo (nada a apagar lá). Em ambos o tombstone está cumprido.
        if (res.ok || res.status === 404) await typeStore.markState(t.id, t.updatedAt, 'synced')
        else if (transient(res.status)) return
        else await typeStore.markState(t.id, t.updatedAt, 'rejected')
        continue
      }
      const res = await api.put('/api/types', { types: [typeToServer(t)] })
      if (res.ok) {
        // `ignored` = perdeu o LWW para uma versão mais nova; o pull a traz.
        await typeStore.markState(t.id, t.updatedAt, 'synced')
      } else if (transient(res.status)) {
        return
      } else {
        await typeStore.markState(t.id, t.updatedAt, 'rejected')
      }
    }

    const pending = await assignmentStore.listPending()
    for (let i = 0; i < pending.length; i += PUSH_BATCH) {
      const chunk = pending.slice(i, i + PUSH_BATCH)
      const res = await api.put('/api/type-assignments', { assignments: chunk.map(assignmentToServer) })
      if (res.ok) {
        const body: { skipped: string[] } = await res.json()
        const skipped = new Set(body.skipped)
        for (const r of chunk) if (!skipped.has(r.id)) await assignmentStore.markState(r.id, r.updatedAt, 'synced')
      } else if (transient(res.status)) {
        return
      } else {
        // Um item inválido recusa o lote inteiro: reenvia um a um para isolá-lo.
        for (const r of chunk) {
          const one = await api.put('/api/type-assignments', { assignments: [assignmentToServer(r)] })
          if (one.ok) {
            const body: { skipped: string[] } = await one.json()
            if (!body.skipped.includes(r.id)) await assignmentStore.markState(r.id, r.updatedAt, 'synced')
          } else if (transient(one.status)) {
            return
          } else {
            await assignmentStore.markState(r.id, r.updatedAt, 'rejected')
          }
        }
      }
    }
  } catch (err) {
    if (err instanceof AuthError) throw err
    // rede — fica pendente
  }
}

// --- mutações locais (a UI grava aqui; o envio é em segundo plano) ---

export interface TypeDraft {
  /** Sem id = tipo novo. */
  id?: string
  name: string
  icon: string
  color: string
  template: string
  protectedSections: string[]
  levels: TypeLevel[]
  countsProgress: boolean
}

export type SaveTypeResult = { ok: true; type: ZettelType } | { ok: false; errors: string[] }

/** Slug livre entre os tipos vivos (acrescenta -2, -3… se preciso). */
function freeSlug(base: string, taken: Set<string>): string {
  const root = base || 'tipo'
  if (!taken.has(root)) return root
  for (let n = 2; n < 1000; n++) {
    const candidate = `${root.slice(0, 36)}-${n}`
    if (!taken.has(candidate)) return candidate
  }
  return `${root.slice(0, 30)}-${Date.now() % 100000}`
}

/**
 * Cria ou edita um tipo, localmente e sem esperar o servidor. O slug nasce do
 * nome e nunca muda depois (as skills do agente o usam para achar o tipo).
 */
export async function saveType(draft: TypeDraft): Promise<SaveTypeResult> {
  const all = await typeStore.getAll()
  const live = all.filter((t) => !t.deletedAt)
  const prev = draft.id ? all.find((t) => t.id === draft.id && !t.deletedAt) : undefined
  if (draft.id && !prev) return { ok: false, errors: ['este tipo não existe mais'] }
  if (!prev && live.length >= MAX_TYPES) return { ok: false, errors: [`no máximo ${MAX_TYPES} tipos`] }

  const slug =
    prev?.slug ??
    freeSlug(
      slugify(draft.name),
      new Set(live.map((t) => t.slug)),
    )
  const candidate = {
    name: draft.name.trim(),
    slug,
    icon: draft.icon,
    color: draft.color,
    template: draft.template,
    protectedSections: draft.protectedSections.map((s) => s.trim()).filter(Boolean),
    levels: draft.levels,
  }
  const errors = validateType(candidate)
  if (errors.length > 0) return { ok: false, errors }
  // Remover um nível é permitido: as atribuições dele passam a valer "sem nível".
  if (!isValidSlug(slug)) return { ok: false, errors: ['o nome não gera um slug válido'] }

  const type: ZettelType = {
    id: prev?.id ?? generateId(),
    ...candidate,
    countsProgress: draft.countsProgress,
    updatedAt: nextAt(prev?.updatedAt),
    deletedAt: null,
  }
  await typeStore.putMany([{ ...type, syncState: 'pending' }])
  emitChanged()
  void pushPendingTypes().catch(() => {})
  return { ok: true, type }
}

/**
 * Apaga um tipo: os zettels dele ficam sem tipo (nenhum é alterado ou
 * apagado). Devolve quantos foram soltos.
 */
export async function removeType(id: string): Promise<number> {
  const cur = await typeStore.get(id)
  if (!cur || cur.deletedAt) return 0
  const now = nextAt(cur.updatedAt)
  await typeStore.putMany([{ ...cur, deletedAt: now, updatedAt: now, syncState: 'pending' }])
  // O servidor faz o mesmo em cascata; localmente solta já, para a UI não esperar.
  const released: AssignmentRecord[] = (await assignmentStore.getAll())
    .filter((a) => a.typeId === id && !a.deletedAt)
    .map((a) => ({ ...a, level: null, deletedAt: now, syncState: 'synced' as const }))
  await assignmentStore.putMany(released)
  emitChanged()
  void pushPendingTypes().catch(() => {})
  return released.length
}

/** Quantos zettels vivos usam o tipo (e, opcionalmente, estão num nível). */
export async function countUsing(typeId: string, levelKey?: string): Promise<number> {
  return (await assignmentStore.getAll()).filter(
    (a) => a.typeId === typeId && !a.deletedAt && (levelKey === undefined || a.level === levelKey),
  ).length
}

export type AssignResult = { ok: true } | { ok: false; error: string }

/**
 * Atribui tipo e nível a um zettel (`typeId` nulo = sem tipo). `level`: uma
 * chave define o nível, `null` o limpa e `undefined` mantém o atual no mesmo
 * tipo. Trocar o tipo limpa o nível, a menos que `level` seja válido para o
 * tipo novo. Só grava localmente: o corpo e o `updated_at` do zettel não mudam.
 */
export async function assign(zettelId: string, typeId: string | null, level?: string | null): Promise<AssignResult> {
  const cur = await assignmentStore.get(zettelId)
  if (typeId === null) {
    if (!cur || cur.deletedAt) return { ok: true }
    await assignmentStore.putMany([
      { ...cur, level: null, deletedAt: nextAt(cur.updatedAt), updatedAt: nextAt(cur.updatedAt), syncState: 'pending' },
    ])
    emitChanged()
    void pushPendingTypes().catch(() => {})
    return { ok: true }
  }
  const type = await typeStore.get(typeId)
  if (!type || type.deletedAt) return { ok: false, error: 'este tipo não existe mais' }
  const sameType = !!cur && !cur.deletedAt && cur.typeId === typeId
  const wanted = level === undefined ? (sameType ? cur!.level : null) : level
  const problem = validateLevel(type, wanted)
  if (problem) return { ok: false, error: problem }
  const finalLevel = sameType ? wanted : levelAfterTypeChange(type, wanted)
  if (sameType && (cur!.level ?? null) === (finalLevel ?? null)) return { ok: true }
  await assignmentStore.putMany([
    {
      id: zettelId,
      typeId,
      level: finalLevel,
      updatedAt: nextAt(cur?.updatedAt),
      deletedAt: null,
      syncState: 'pending',
    },
  ])
  emitChanged()
  void pushPendingTypes().catch(() => {})
  return { ok: true }
}

/** Template (corpo inicial) de um tipo vivo; vazio se o tipo não existe ou não tem. */
export async function templateOf(typeId: string): Promise<string> {
  const t = await typeStore.get(typeId)
  return t && !t.deletedAt ? t.template : ''
}

/** O zettel foi apagado: descarta a atribuição local (o servidor faz o mesmo). */
export async function dropAssignment(zettelId: string): Promise<void> {
  const cur = await assignmentStore.get(zettelId)
  if (!cur) return
  await assignmentStore.delete(zettelId)
  emitChanged()
}
