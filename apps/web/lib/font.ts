export type FontId = 'system' | 'serif' | 'mono';

export interface Font {
  id: FontId;
  label: string;
  stack: string;
  preview: string;
}

export const FONTS: Font[] = [
  {
    id: 'system',
    label: 'Padrão',
    stack: 'ui-sans-serif, system-ui, -apple-system, sans-serif',
    preview: 'Aa',
  },
  {
    id: 'serif',
    label: 'Serifa',
    stack: 'var(--font-lora), Georgia, "Times New Roman", serif',
    preview: 'Aa',
  },
  {
    id: 'mono',
    label: 'Mono',
    stack: 'var(--font-jetbrains), ui-monospace, "Cascadia Code", Consolas, monospace',
    preview: 'Aa',
  },
];

export const DEFAULT_FONT_ID: FontId = 'system';
const STORAGE_KEY = 'zettel_font';

export function applyFont(id: FontId): void {
  const font = FONTS.find((f) => f.id === id) ?? FONTS[0];
  document.documentElement.style.setProperty('--font-body', font.stack);
  localStorage.setItem(STORAGE_KEY, id);
}

export function getSavedFontId(): FontId {
  try {
    const saved = localStorage.getItem(STORAGE_KEY) as FontId | null;
    return FONTS.some((f) => f.id === saved) ? saved! : DEFAULT_FONT_ID;
  } catch {
    return DEFAULT_FONT_ID;
  }
}

// Injected into <head> before React hydrates — prevents font flash on load.
// Must remain a self-contained string with no imports.
export const FONT_SCRIPT = `(function(){try{var S={system:'ui-sans-serif,system-ui,-apple-system,sans-serif',serif:'var(--font-lora),Georgia,"Times New Roman",serif',mono:'var(--font-jetbrains),ui-monospace,"Cascadia Code",Consolas,monospace'};var id=localStorage.getItem('zettel_font')||'system';var stack=S[id]||S.system;document.documentElement.style.setProperty('--font-body',stack);}catch(e){}})();`;
