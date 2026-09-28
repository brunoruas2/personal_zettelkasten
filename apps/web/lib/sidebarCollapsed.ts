'use client';

import { useCallback, useSyncExternalStore } from 'react';

const STORAGE_KEY = 'zettel_sidebar_collapsed';
const EVENT_NAME = 'zettel-sidebar-collapsed';

export function getSavedSidebarCollapsed(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

// Mesmo molde de readingWidth.ts: o evento existe porque `storage` só dispara em outras abas.
// Sem localStorage a escolha se perde, então guardamos também em memória para valer na sessão.
let memoryValue: boolean | null = null;

export function setSidebarCollapsed(collapsed: boolean): void {
  memoryValue = collapsed;
  try {
    localStorage.setItem(STORAGE_KEY, collapsed ? '1' : '0');
  } catch {
    // localStorage indisponível — a escolha vale só para esta sessão
  }
  window.dispatchEvent(new CustomEvent(EVENT_NAME));
}

function getSnapshot(): boolean {
  return memoryValue ?? getSavedSidebarCollapsed();
}

function subscribe(onChange: () => void): () => void {
  const onStorage = (e: StorageEvent) => {
    if (e.key === null || e.key === STORAGE_KEY) {
      memoryValue = null;
      onChange();
    }
  };
  window.addEventListener(EVENT_NAME, onChange);
  window.addEventListener('storage', onStorage);
  return () => {
    window.removeEventListener(EVENT_NAME, onChange);
    window.removeEventListener('storage', onStorage);
  };
}

export function useSidebarCollapsed(): readonly [boolean, (collapsed: boolean) => void, () => void] {
  const collapsed = useSyncExternalStore(subscribe, getSnapshot, () => false);
  const toggle = useCallback(() => setSidebarCollapsed(!getSnapshot()), []);
  return [collapsed, setSidebarCollapsed, toggle] as const;
}
