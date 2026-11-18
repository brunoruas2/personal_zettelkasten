import { create } from 'zustand';

/** Quanto tempo um zettel tocado pelo agente fica destacado. */
export const AGENT_HIGHLIGHT_MS = 8000;
/** Janela em que a atividade do agente vira um único toast. */
export const AGENT_TOAST_WINDOW_MS = 2000;

export type AgentOp = 'create' | 'update' | 'delete';

export interface AgentEntry {
  op: AgentOp;
  at: number;
}

export interface AgentToast {
  seq: number;
  text: string;
  /** Zettel para o "Abrir" (só quando é um zettel, não apagado). */
  openId: string | null;
}

export interface AgentChange {
  id: string;
  op: AgentOp;
  title: string;
}

interface AgentActivityState {
  /** Ids tocados pelo agente nos últimos AGENT_HIGHLIGHT_MS. */
  active: Record<string, AgentEntry>;
  /** Último toast agregado; as interfaces mostram quando `seq` muda. */
  toast: AgentToast | null;
  /** Ids com evento do agente desde a última leitura (conflito no editor). */
  touchedSeq: number;
  touched: Record<string, number>;
  record: (changes: AgentChange[]) => void;
  clear: () => void;
}

const expiry = new Map<string, ReturnType<typeof setTimeout>>();
let toastBatch: AgentChange[] = [];
let windowTimer: ReturnType<typeof setTimeout> | null = null;
let toastSeq = 0;

const VERB: Record<AgentOp, string> = { create: 'criou', update: 'editou', delete: 'apagou' };

/** Texto do toast agregado (exportado para teste). */
export function agentToastText(changes: AgentChange[]): { text: string; openId: string | null } {
  const byId = new Map<string, AgentChange>();
  for (const c of changes) {
    const prev = byId.get(c.id);
    // create seguido de update continua "criou"; delete vence.
    if (!prev || c.op === 'delete' || prev.op !== 'create') byId.set(c.id, { ...c, title: c.title || prev?.title || '' });
  }
  const list = [...byId.values()];
  if (list.length === 1) {
    const c = list[0];
    const title = c.title.trim() || 'sem título';
    return { text: `Agente: ${VERB[c.op]} «${title}»`, openId: c.op === 'delete' ? null : c.id };
  }
  return { text: `Agente: alterou ${list.length} zettels`, openId: null };
}

export const useAgentActivityStore = create<AgentActivityState>((set, get) => ({
  active: {},
  toast: null,
  touchedSeq: 0,
  touched: {},

  record: (changes) => {
    if (changes.length === 0) return;
    const now = Date.now();
    const active = { ...get().active };
    const touched = { ...get().touched };
    for (const c of changes) {
      active[c.id] = { op: c.op, at: now };
      touched[c.id] = now;
      const old = expiry.get(c.id);
      if (old) clearTimeout(old);
      expiry.set(
        c.id,
        setTimeout(() => {
          expiry.delete(c.id);
          const rest = { ...get().active };
          delete rest[c.id];
          set({ active: rest });
        }, AGENT_HIGHLIGHT_MS),
      );
    }
    set({ active, touched, touchedSeq: get().touchedSeq + 1 });

    toastBatch.push(...changes);
    if (!windowTimer) {
      windowTimer = setTimeout(() => {
        windowTimer = null;
        const batch = toastBatch;
        toastBatch = [];
        const { text, openId } = agentToastText(batch);
        set({ toast: { seq: ++toastSeq, text, openId } });
      }, AGENT_TOAST_WINDOW_MS);
    }
  },

  clear: () => {
    expiry.forEach((t) => clearTimeout(t));
    expiry.clear();
    if (windowTimer) clearTimeout(windowTimer);
    windowTimer = null;
    toastBatch = [];
    set({ active: {}, toast: null, touched: {} });
  },
}));
