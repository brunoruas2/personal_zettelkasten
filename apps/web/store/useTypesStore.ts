import { create } from 'zustand'
import { effectiveLevel, findLevel, liveTypes, type TypeLevel, type ZettelType } from '@zettelkasten/core'
import { assignmentStore, subscribeTypes, typeStore } from '../lib/typeSync'

/** Tipo e nível efetivos de um zettel. `level` é nulo se não há nível (ou se a chave guardada saiu do tipo). */
export interface ZettelTypeInfo {
  type: ZettelType
  level: TypeLevel | null
}

interface TypesState {
  /** Já leu o IndexedDB pelo menos uma vez. */
  ready: boolean
  /** Tipos vivos, por nome. */
  types: ZettelType[]
  typeById: Map<string, ZettelType>
  /** Atribuições vivas a um tipo vivo. O índice global de zettels não muda. */
  assignments: Map<string, { typeId: string; level: string | null }>
  /** Tipos ou atribuições que o servidor recusou (ficam só neste aparelho). */
  rejected: number
  reload: () => Promise<void>
}

let loading: Promise<void> | null = null
let again = false

export const useTypesStore = create<TypesState>((set) => {
  const load = async () => {
    const [typeRecords, assignRecords] = await Promise.all([typeStore.getAll(), assignmentStore.getAll()])
    const types = liveTypes(typeRecords.filter((t) => !t.deletedAt))
    const typeById = new Map(types.map((t) => [t.id, t]))
    const assignments = new Map<string, { typeId: string; level: string | null }>()
    for (const a of assignRecords) {
      const t = typeById.get(a.typeId)
      if (a.deletedAt || !t) continue
      assignments.set(a.id, { typeId: a.typeId, level: effectiveLevel(t, a.level) })
    }
    const rejected =
      typeRecords.filter((t) => t.syncState === 'rejected').length +
      assignRecords.filter((a) => a.syncState === 'rejected').length
    set({ ready: true, types, typeById, assignments, rejected })
  }
  return {
    ready: false,
    types: [],
    typeById: new Map(),
    assignments: new Map(),
    rejected: 0,
    // Coalesce: várias mudanças seguidas (um pull com centenas de atribuições)
    // viram uma releitura, mais uma se algo mudou durante ela.
    reload: () => {
      if (loading) {
        again = true
        return loading
      }
      loading = load()
        .catch(() => {})
        .finally(() => {
          loading = null
          if (again) {
            again = false
            void useTypesStore.getState().reload()
          }
        })
      return loading
    },
  }
})

/** Lê o IndexedDB e passa a acompanhar mudanças locais e de sync. Devolve o cancelamento. */
export function initTypesStore(): () => void {
  void useTypesStore.getState().reload()
  return subscribeTypes(() => void useTypesStore.getState().reload())
}

/** Tipo e nível de um zettel, direto do estado (para filtros e laços fora do React). */
export function typeInfoOf(
  state: Pick<TypesState, 'typeById' | 'assignments'>,
  zettelId: string,
): ZettelTypeInfo | null {
  const a = state.assignments.get(zettelId)
  if (!a) return null
  const type = state.typeById.get(a.typeId)
  if (!type) return null
  return { type, level: findLevel(type, a.level) ?? null }
}

/** Hook: tipo e nível do zettel. Re-renderiza só quando a atribuição dele muda. */
export function useZettelType(zettelId: string | null | undefined): ZettelTypeInfo | null {
  const assignment = useTypesStore((s) => (zettelId ? s.assignments.get(zettelId) : undefined))
  const type = useTypesStore((s) => (assignment ? s.typeById.get(assignment.typeId) : undefined))
  if (!assignment || !type) return null
  return { type, level: findLevel(type, assignment.level) ?? null }
}
