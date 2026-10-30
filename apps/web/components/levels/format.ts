import type { SaveStatus } from '../galaxy/InplaceEditor';

/** Código exibido na barra de título: `ZK-` + fim do id (só para olhar, não é chave). */
export function zkCode(id: string): string {
  return `ZK-${id.slice(-4).toUpperCase()}`;
}

export function saveLabel(s: SaveStatus): string {
  switch (s) {
    case 'saving':
      return 'salvando…';
    case 'saved':
      return '■ salvo';
    case 'offline':
      return '■ salvo neste aparelho';
    case 'error':
      return '! erro ao salvar';
    default:
      return '';
  }
}
