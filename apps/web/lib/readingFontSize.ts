'use client';

import { useSyncExternalStore } from 'react';

export const READING_SCALE_MIN = 80;
export const READING_SCALE_MAX = 200;
export const READING_SCALE_STEP = 10;
export const DEFAULT_READING_SCALE = 100;
const STORAGE_KEY = 'zettel_reading_scale';
const EVENT_NAME = 'zettel-reading-scale';

function clamp(percent: number): number {
  const snapped = Math.round(percent / READING_SCALE_STEP) * READING_SCALE_STEP;
  return Math.min(READING_SCALE_MAX, Math.max(READING_SCALE_MIN, snapped));
}

export function getSavedReadingScale(): number {
  try {
    const saved = Number(localStorage.getItem(STORAGE_KEY));
    return Number.isFinite(saved) && saved > 0 ? clamp(saved) : DEFAULT_READING_SCALE;
  } catch {
    return DEFAULT_READING_SCALE;
  }
}

// Sem DOM: o fator é aplicado por React (variável CSS no ZettelWindow). O evento
// existe porque `storage` só dispara para *outras* abas.
export function applyReadingScale(percent: number): void {
  try {
    localStorage.setItem(STORAGE_KEY, String(clamp(percent)));
  } catch {
    // localStorage indisponível (Safari privado) — vale só para esta sessão
  }
  window.dispatchEvent(new CustomEvent(EVENT_NAME));
}

export function stepReadingScale(delta: 1 | -1): void {
  applyReadingScale(getSavedReadingScale() + delta * READING_SCALE_STEP);
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

// getServerSnapshot: a página passa pelo SSR do Next, onde não há `localStorage`.
export function useReadingScale(): number {
  return useSyncExternalStore(subscribe, getSavedReadingScale, () => DEFAULT_READING_SCALE);
}
