'use client';

import { useSyncExternalStore } from 'react';

export type ReadingWidthId = 'narrow' | 'medium' | 'wide';

export interface ReadingWidth {
  id: ReadingWidthId;
  label: string;
  description: string;
  // Classe completa (não `lg:${x}`): o Tailwind só enxerga strings literais.
  // Só vale a partir de lg — abaixo disso a coluna segue o max-w-2xl do layout.
  className: string;
}

export const READING_WIDTHS: ReadingWidth[] = [
  { id: 'narrow', label: 'Estreita', description: 'Coluna de leitura compacta', className: 'lg:max-w-4xl' },
  { id: 'medium', label: 'Média', description: 'Coluna mais larga', className: 'lg:max-w-6xl' },
  { id: 'wide', label: 'Larga', description: 'Aproveita telas grandes', className: 'lg:max-w-[96rem]' },
];

export const DEFAULT_READING_WIDTH_ID: ReadingWidthId = 'narrow';
const STORAGE_KEY = 'zettel_reading_width';
const EVENT_NAME = 'zettel-reading-width';

export function getSavedReadingWidthId(): ReadingWidthId {
  try {
    const saved = localStorage.getItem(STORAGE_KEY) as ReadingWidthId | null;
    return READING_WIDTHS.some((w) => w.id === saved) ? saved! : DEFAULT_READING_WIDTH_ID;
  } catch {
    return DEFAULT_READING_WIDTH_ID;
  }
}

// Mesmo molde de diagramLayout.ts: não escreve no DOM; o evento existe porque `storage`
// só dispara em outras abas.
export function applyReadingWidth(id: ReadingWidthId): void {
  try {
    localStorage.setItem(STORAGE_KEY, id);
  } catch {
    // localStorage indisponível — a escolha vale só para esta sessão
  }
  window.dispatchEvent(new CustomEvent(EVENT_NAME));
}

function subscribe(onChange: () => void): () => void {
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

export function useReadingWidth(): ReadingWidthId {
  return useSyncExternalStore(subscribe, getSavedReadingWidthId, () => DEFAULT_READING_WIDTH_ID);
}

/** Classe `lg:max-w-*` da largura escolhida. */
export function useReadingWidthClass(): string {
  const id = useReadingWidth();
  return (READING_WIDTHS.find((w) => w.id === id) ?? READING_WIDTHS[0]).className;
}
