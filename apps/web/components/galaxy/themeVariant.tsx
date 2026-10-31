'use client';

import { createContext, useContext } from 'react';

/**
 * Visual das sobreposições compartilhadas (modal, busca, paleta, menu,
 * confirmação). A galáxia usa o padrão; o `Levels` provê `'zkos'`.
 */
export type ThemeVariant = 'galaxy' | 'zkos';

export const ThemeVariantContext = createContext<ThemeVariant>('galaxy');

export function useThemeVariant(): ThemeVariant {
  return useContext(ThemeVariantContext);
}

/** Escolhe a string de classes da variante (strings completas, para o Tailwind). */
export function cx(variant: ThemeVariant, galaxy: string, zkos: string): string {
  return variant === 'zkos' ? zkos : galaxy;
}
