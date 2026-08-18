export type ThemeId = 'purple' | 'matrix' | 'blue' | 'amber';

export interface Theme {
  id: ThemeId;
  label: string;
  brand: string;       // RGB triplet sem parênteses, ex: "124 58 237"
  brandLight: string;
}

export const THEMES: Theme[] = [
  { id: 'purple', label: 'Roxo',         brand: '124 58 237',  brandLight: '167 139 250' },
  { id: 'matrix', label: 'Verde Matrix', brand: '0 150 50',    brandLight: '74 222 128'  },
  { id: 'blue',   label: 'Azul',         brand: '37 99 235',   brandLight: '96 165 250'  },
  { id: 'amber',  label: 'Âmbar',        brand: '217 119 6',   brandLight: '251 191 36'  },
];

export const DEFAULT_THEME_ID: ThemeId = 'purple';
const STORAGE_KEY = 'zettel_theme';

export function applyTheme(id: ThemeId): void {
  const theme = THEMES.find(t => t.id === id) ?? THEMES[0];
  const root = document.documentElement;
  root.style.setProperty('--color-brand', theme.brand);
  root.style.setProperty('--color-brand-light', theme.brandLight);
  localStorage.setItem(STORAGE_KEY, id);
}

export function getSavedThemeId(): ThemeId {
  try {
    const saved = localStorage.getItem(STORAGE_KEY) as ThemeId | null;
    return THEMES.some(t => t.id === saved) ? saved! : DEFAULT_THEME_ID;
  } catch {
    return DEFAULT_THEME_ID;
  }
}

// Script inline para o <head>: aplica o tema antes do primeiro paint e evita flash de cor.
// Deve ser uma string pura (sem imports) — executada pelo browser antes do React hidratar.
export const THEME_SCRIPT = `(function(){try{var T={purple:['124 58 237','167 139 250'],matrix:['0 150 50','74 222 128'],blue:['37 99 235','96 165 250'],amber:['217 119 6','251 191 36']};var id=localStorage.getItem('zettel_theme')||'purple';var t=T[id]||T.purple;var r=document.documentElement;r.style.setProperty('--color-brand',t[0]);r.style.setProperty('--color-brand-light',t[1]);}catch(e){}})();`;
