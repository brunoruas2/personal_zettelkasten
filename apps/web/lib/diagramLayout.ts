'use client';

import { useSyncExternalStore } from 'react';

export type DiagramLayoutId = 'side' | 'below';

export interface DiagramLayout {
  id: DiagramLayoutId;
  label: string;
  description: string;
}

export const DIAGRAM_LAYOUTS: DiagramLayout[] = [
  {
    id: 'side',
    label: 'Lado a lado',
    description: 'Código à esquerda, diagrama à direita',
  },
  {
    id: 'below',
    label: 'Abaixo do editor',
    description: 'Código em cima, diagrama embaixo',
  },
];

export const DEFAULT_DIAGRAM_LAYOUT_ID: DiagramLayoutId = 'side';
const STORAGE_KEY = 'zettel_diagram_layout';
const EVENT_NAME = 'zettel-diagram-layout';

export function getSavedDiagramLayoutId(): DiagramLayoutId {
  try {
    const saved = localStorage.getItem(STORAGE_KEY) as DiagramLayoutId | null;
    return DIAGRAM_LAYOUTS.some((l) => l.id === saved) ? saved! : DEFAULT_DIAGRAM_LAYOUT_ID;
  } catch {
    return DEFAULT_DIAGRAM_LAYOUT_ID;
  }
}

// Diferente de applyTheme/applyFont, não escreve nada no DOM — o layout é
// decidido em React, dentro do NodeView. O evento existe porque `storage` só
// dispara para *outras* abas; sem ele a aba que gravou não se atualizaria.
export function applyDiagramLayout(id: DiagramLayoutId): void {
  try {
    localStorage.setItem(STORAGE_KEY, id);
  } catch {
    // localStorage indisponível (Safari privado) — a escolha vale só para esta sessão
  }
  window.dispatchEvent(new CustomEvent(EVENT_NAME));
}

export function subscribeDiagramLayout(onChange: () => void): () => void {
  const onStorage = (e: StorageEvent) => {
    if (e.key === null || e.key === STORAGE_KEY) onChange();
  };
  window.addEventListener(EVENT_NAME, onChange);
  window.addEventListener('storage', onStorage);
  return () => {
    window.removeEventListener(EVENT_NAME, onChange);
    window.removeEventListener('storage', onStorage);
  };
}

// getServerSnapshot é obrigatório: as páginas de editor são 'use client' mas
// ainda passam pelo SSR do Next, onde `localStorage` não existe.
export function useDiagramLayout(): DiagramLayoutId {
  return useSyncExternalStore(
    subscribeDiagramLayout,
    getSavedDiagramLayoutId,
    () => DEFAULT_DIAGRAM_LAYOUT_ID,
  );
}
