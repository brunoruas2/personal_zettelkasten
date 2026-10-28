/**
 * Registro único dos atalhos da galáxia. A paleta (`CommandPalette`), a ajuda
 * (`ShortcutsHelp`) e as dicas dos botões leem daqui: um atalho novo entra
 * uma vez e aparece nos três. Os listeners em si continuam onde sempre
 * estiveram (`engine.ts`, `Galaxy.tsx`, leitura, editor de desenho) — este
 * arquivo só descreve.
 */

export type ShortcutScope = 'Galáxia' | 'Câmera' | 'Leitura' | 'Edição' | 'Desenho';

export interface Shortcut {
  id: string;
  label: string;
  /** Como o atalho aparece na tela (teclas separadas por espaço). */
  keys: string;
  scope: ShortcutScope;
}

export const SHORTCUT_SCOPES: ShortcutScope[] = ['Galáxia', 'Câmera', 'Leitura', 'Edição', 'Desenho'];

export const SHORTCUTS: Shortcut[] = [
  { id: 'palette', label: 'Paleta de comandos', keys: 'Ctrl K', scope: 'Galáxia' },
  { id: 'search', label: 'Buscar na galáxia', keys: 'Alt B', scope: 'Galáxia' },
  { id: 'settings', label: 'Configurações', keys: 'Alt ,', scope: 'Galáxia' },
  { id: 'back', label: 'Voltar ao zettel anterior', keys: 'X', scope: 'Galáxia' },
  { id: 'help', label: 'Mostrar os atalhos', keys: '?', scope: 'Galáxia' },
  { id: 'escape', label: 'Sair da edição, do foco ou do filtro de tag', keys: 'Esc', scope: 'Galáxia' },
  { id: 'focus-search', label: 'Focar no resultado da busca', keys: 'Ctrl ↵', scope: 'Galáxia' },
  { id: 'create', label: 'Criar um zettel no ponto', keys: 'Duplo clique no vazio', scope: 'Galáxia' },
  { id: 'zoom-in', label: 'Aproximar', keys: '+', scope: 'Câmera' },
  { id: 'zoom-out', label: 'Afastar', keys: '−', scope: 'Câmera' },
  { id: 'fit', label: 'Ver tudo', keys: '0', scope: 'Câmera' },
  { id: 'zoom-max', label: 'Alternar entre 150% e Ver tudo', keys: 'Z', scope: 'Câmera' },
  { id: 'pan', label: 'Mover a câmera', keys: '← ↑ → ↓', scope: 'Câmera' },
  { id: 'pan-h', label: 'Mover na horizontal', keys: 'Shift roda', scope: 'Câmera' },
  { id: 'zoom-wheel', label: 'Zoom no cursor', keys: 'Ctrl roda', scope: 'Câmera' },
  { id: 'reader-back', label: 'Voltar ao zettel anterior', keys: 'X', scope: 'Leitura' },
  { id: 'reader-close', label: 'Fechar a leitura', keys: 'Esc', scope: 'Leitura' },
  { id: 'wiki-link', label: 'Ligar a outro zettel', keys: '[[', scope: 'Edição' },
  { id: 'slash', label: 'Inserir bloco (diagrama, cifra, tabela…)', keys: '/', scope: 'Edição' },
  { id: 'draw-pen', label: 'Caneta', keys: 'R', scope: 'Desenho' },
  { id: 'draw-hand', label: 'Mão', keys: 'E', scope: 'Desenho' },
  { id: 'draw-select', label: 'Selecionar', keys: 'T', scope: 'Desenho' },
  { id: 'draw-eraser', label: 'Borracha', keys: 'Q', scope: 'Desenho' },
  { id: 'draw-undo', label: 'Desfazer / refazer', keys: 'W · Shift W', scope: 'Desenho' },
  { id: 'draw-pan', label: 'Mover o desenho', keys: 'Espaço arrastar', scope: 'Desenho' },
  { id: 'draw-full', label: 'Tela cheia', keys: 'Alt ↵', scope: 'Desenho' },
];

const byId = new Map(SHORTCUTS.map((s) => [s.id, s]));

/** Teclas de um atalho do registro (`''` se o id não existe). */
export function keysOf(id: string): string {
  return byId.get(id)?.keys ?? '';
}

/** Sufixo de dica de botão: `" (Alt B)"`, ou nada. */
export function hintOf(id: string): string {
  const k = keysOf(id);
  return k ? ` (${k})` : '';
}
