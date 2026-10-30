import type { Link } from '../models/Link';

/**
 * Navegação em três níveis (Foco, Memória, Mapa). Funções puras sobre um
 * estado imutável — o store do app só as aplica. Specs: focus-screen,
 * memory-screen, level-navigation.
 */
export type Level = 'focus' | 'memory' | 'map';
export type EditingIn = 'focus' | 'memory';

/** Zettels consultados na Memória; o mais antigo sai no nono. */
export const CONSULTED_MAX = 8;
/** Últimos focos na trilha. */
export const TRAIL_MAX = 4;

export interface LevelsState {
  level: Level;
  focusId: string | null;
  /** Mais recente primeiro. */
  consulted: string[];
  activeId: string | null;
  /** Só uma janela edita por vez. */
  editing: EditingIn | null;
  trail: string[];
}

export const initialLevels: LevelsState = {
  level: 'focus',
  focusId: null,
  consulted: [],
  activeId: null,
  editing: null,
  trail: [],
};

/**
 * Links de um zettel para carregar na Memória: saídas (na ordem em que
 * aparecem) e depois entradas, sem duplicata e sem o próprio zettel.
 * `isVisible` esconde zettels (tags excluídas).
 */
export function linksOfFocus(id: string, links: readonly Link[], isVisible: (id: string) => boolean = () => true): string[] {
  const seen = new Set<string>([id]);
  const out: string[] = [];
  const add = (other: string) => {
    if (seen.has(other) || !isVisible(other)) return;
    seen.add(other);
    out.push(other);
  };
  for (const l of links) if (l.sourceId === id) add(l.targetId);
  for (const l of links) if (l.targetId === id) add(l.sourceId);
  return out;
}

/** Define o foco: carrega os links na Memória, ativa o primeiro e anota na trilha. */
export function focusOn(
  state: LevelsState,
  id: string,
  links: readonly Link[],
  isVisible?: (id: string) => boolean,
): LevelsState {
  const consulted = linksOfFocus(id, links, isVisible).slice(0, CONSULTED_MAX);
  return {
    level: 'focus',
    focusId: id,
    consulted,
    activeId: consulted[0] ?? null,
    editing: null,
    trail: [...state.trail.filter((x) => x !== id), id].slice(-TRAIL_MAX),
  };
}

/** Consulta um zettel: vai ao topo da Memória e vira o ativo (o foco não muda). */
export function consult(state: LevelsState, id: string): LevelsState {
  const consulted = [id, ...state.consulted.filter((x) => x !== id)].slice(0, CONSULTED_MAX);
  return { ...state, consulted, activeId: id, editing: state.editing === 'memory' ? null : state.editing };
}

/** Tira da Memória e ativa o próximo (ou nenhum). */
export function dismiss(state: LevelsState, id: string): LevelsState {
  const consulted = state.consulted.filter((x) => x !== id);
  const activeId = state.activeId === id ? (consulted[0] ?? null) : state.activeId;
  return { ...state, consulted, activeId, editing: state.editing === 'memory' ? null : state.editing };
}

/** Muda de nível; sair de um nível encerra a edição. */
export function goLevel(state: LevelsState, level: Level): LevelsState {
  if (state.level === level) return state;
  return { ...state, level, editing: null };
}

/** Abre a edição numa janela; só uma por vez. No Foco exige foco, na Memória um ativo. */
export function startEditing(state: LevelsState, where: EditingIn): LevelsState {
  if (where === 'focus' && state.focusId === null) return state;
  if (where === 'memory' && state.activeId === null) return state;
  return { ...state, editing: where };
}

export function stopEditing(state: LevelsState): LevelsState {
  return state.editing === null ? state : { ...state, editing: null };
}

/**
 * Voltar do sistema: encerra a edição; sem edição, volta de nível
 * (mapa → memória → foco). `exit` quando não há mais para onde voltar.
 */
export function backStep(state: LevelsState): { state: LevelsState; exit: boolean } {
  if (state.editing !== null) return { state: stopEditing(state), exit: false };
  if (state.level === 'map') return { state: goLevel(state, 'memory'), exit: false };
  if (state.level === 'memory') return { state: goLevel(state, 'focus'), exit: false };
  return { state, exit: true };
}

/** Descarta ids que deixaram de existir (zettel apagado em outro aparelho). */
export function pruneMissing(state: LevelsState, exists: (id: string) => boolean): LevelsState {
  const focusId = state.focusId !== null && exists(state.focusId) ? state.focusId : null;
  const consulted = state.consulted.filter(exists);
  const activeId = state.activeId !== null && consulted.includes(state.activeId) ? state.activeId : (consulted[0] ?? null);
  const trail = state.trail.filter(exists);
  const changed =
    focusId !== state.focusId || consulted.length !== state.consulted.length || activeId !== state.activeId || trail.length !== state.trail.length;
  if (!changed) return state;
  return { ...state, focusId, consulted, activeId, trail, editing: focusId === null ? null : state.editing };
}
