import { api, AuthError } from './api';

/** Evento de GET /api/events. Nunca traz dados: o cliente faz pull. */
export interface RealtimeEvent {
  kind: 'zettel' | 'drawing' | 'type' | 'resync';
  op?: 'upsert' | 'delete';
  ids?: string[];
  source?: 'agent' | 'ui';
  at: number;
}

/** Janela em que eventos viram um único ciclo de sincronização. */
export const COALESCE_MS = 300;
const BACKOFF_MIN_MS = 1000;
const BACKOFF_MAX_MS = 30000;

/**
 * Parser SSE mínimo: acumula texto, separa eventos por linha em branco e
 * devolve o JSON de cada `data:`. Comentários (`: ping`) são ignorados.
 */
export function createSseParser(onData: (data: string) => void): (chunk: string) => void {
  let buf = '';
  return (chunk) => {
    buf += chunk.replace(/\r\n/g, '\n');
    let end: number;
    while ((end = buf.indexOf('\n\n')) >= 0) {
      const block = buf.slice(0, end);
      buf = buf.slice(end + 2);
      const data = block
        .split('\n')
        .filter((l) => l.startsWith('data:'))
        .map((l) => l.slice(5).replace(/^ /, ''))
        .join('\n');
      if (data) onData(data);
    }
  };
}

export interface RealtimeOptions {
  /** Lote de eventos agrupados em COALESCE_MS. `reconnected` = o stream caiu e voltou (ciclo completo). */
  onBatch: (events: RealtimeEvent[], reconnected: boolean) => void;
}

/**
 * Mantém GET /api/events aberto enquanto a aba está visível: fecha ao ficar
 * oculta, reabre ao voltar, e reconecta com backoff (1 s → 30 s) quando cai.
 * Devolve a função que encerra tudo (logout).
 */
export function startRealtime({ onBatch }: RealtimeOptions): () => void {
  let stopped = false;
  let ctrl: AbortController | null = null;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;
  let backoff = BACKOFF_MIN_MS;
  let hadConnection = false;

  let pending: RealtimeEvent[] = [];
  let pendingReconnect = false;
  let flushTimer: ReturnType<typeof setTimeout> | null = null;
  const queue = (ev: RealtimeEvent | null, reconnected = false) => {
    if (ev) pending.push(ev);
    if (reconnected) pendingReconnect = true;
    if (flushTimer) return;
    flushTimer = setTimeout(() => {
      flushTimer = null;
      const batch = pending;
      const rec = pendingReconnect;
      pending = [];
      pendingReconnect = false;
      onBatch(batch, rec);
    }, COALESCE_MS);
  };

  const scheduleRetry = () => {
    if (stopped || document.visibilityState !== 'visible' || retryTimer) return;
    retryTimer = setTimeout(() => {
      retryTimer = null;
      void connect();
    }, backoff);
    backoff = Math.min(backoff * 2, BACKOFF_MAX_MS);
  };

  const connect = async () => {
    if (stopped || ctrl || document.visibilityState !== 'visible') return;
    const mine = new AbortController();
    ctrl = mine;
    try {
      const res = await api.stream('/api/events', mine.signal);
      if (!res.ok || !res.body) throw new Error(`events ${res.status}`);
      backoff = BACKOFF_MIN_MS;
      // Reabriu depois de cair ou de a aba ficar oculta: pode ter perdido eventos.
      if (hadConnection) queue(null, true);
      hadConnection = true;
      const parse = createSseParser((data) => {
        try {
          queue(JSON.parse(data) as RealtimeEvent);
        } catch {
          // evento malformado: ignora
        }
      });
      const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        parse(value);
      }
    } catch (err) {
      if (err instanceof AuthError) {
        stopped = true; // sessão morreu: o AuthProvider redireciona
        return;
      }
    } finally {
      if (ctrl === mine) ctrl = null;
    }
    if (!mine.signal.aborted) scheduleRetry();
  };

  const onVisibility = () => {
    if (document.visibilityState === 'visible') {
      backoff = BACKOFF_MIN_MS;
      void connect();
    } else {
      // Na volta, o visibilitychange do DatabaseProvider já faz o ciclo
      // completo; só a queda com a aba visível pede ciclo de reconexão.
      hadConnection = false;
      ctrl?.abort();
      ctrl = null;
      if (retryTimer) clearTimeout(retryTimer);
      retryTimer = null;
    }
  };
  document.addEventListener('visibilitychange', onVisibility);
  void connect();

  return () => {
    stopped = true;
    document.removeEventListener('visibilitychange', onVisibility);
    ctrl?.abort();
    if (retryTimer) clearTimeout(retryTimer);
    if (flushTimer) clearTimeout(flushTimer);
  };
}
