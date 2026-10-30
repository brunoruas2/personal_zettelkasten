'use client';

import { splitCapture } from '@zettelkasten/core';
import { api } from '../../lib/api';
import { useZettelStore } from '../../store/useZettelStore';
import { useLevelsStore } from '../../store/useLevelsStore';
import { flushActiveEdit, requestTitleFocus } from './ZettelWindow';

/** Zettels criados nesta sessão e ainda não editados: se saírem vazios, são apagados. */
const fresh = new Set<string>();

let templateCache: string | null = null;

/** `zettel_template` do usuário (uma vez por sessão; offline = corpo vazio). */
async function loadTemplate(): Promise<string> {
  if (templateCache !== null) return templateCache;
  try {
    const res = await api.get('/api/auth/settings');
    const data = res.ok ? await res.json() : null;
    templateCache = typeof data?.zettel_template === 'string' ? data.zettel_template : '';
  } catch {
    return '';
  }
  return templateCache ?? '';
}

/** "+ Nova": cria um zettel, põe em foco e abre a edição com o cursor no título. */
export async function createNote(): Promise<void> {
  const { createZettel } = useZettelStore.getState();
  const z = await createZettel({ title: '', body: await loadTemplate(), tags: [] });
  fresh.add(z.id);
  requestTitleFocus(z.id);
  await flushActiveEdit();
  const st = useLevelsStore.getState();
  st.setFocus(z.id);
  st.startEdit('focus');
}

/**
 * Captura rápida: grava na caixa de entrada (tag `inbox`) sem abrir o editor
 * nem mudar o foco. Devolve o zettel criado (para a ação "Abrir").
 */
export async function captureNote(text: string): Promise<{ id: string } | null> {
  const { title, body } = splitCapture(text);
  if (!title && !body) return null;
  const z = await useZettelStore.getState().createZettel({ title, body, tags: ['inbox'] });
  return { id: z.id };
}

/**
 * Ao sair da edição de um zettel recém-criado que ficou vazio e que ninguém
 * cita: apaga (volta ao foco anterior). Zettel antigo nunca é candidato.
 */
export async function discardIfEmpty(id: string, empty: boolean): Promise<void> {
  if (!fresh.has(id)) return;
  fresh.delete(id);
  if (!empty) return;
  const { links, deleteZettel } = useZettelStore.getState();
  if (links.some((l) => l.targetId === id && l.sourceId !== id)) return;
  const lv = useLevelsStore.getState();
  const prev = [...lv.trail].reverse().find((x) => x !== id);
  if (lv.focusId === id && prev) lv.setFocus(prev);
  await deleteZettel(id);
}

/** Uma vez editado com conteúdo, o zettel deixa de ser candidato ao descarte. */
export function forgetFresh(id: string): void {
  fresh.delete(id);
}
