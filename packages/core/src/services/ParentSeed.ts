/**
 * Corpo inicial de um zettel criado por "Criar «X»…" no autocomplete `[[`:
 * `[[^<pai>]]` na primeira linha, seguido de linha em branco. Vazio se o pai
 * não tem título ou se o título conteria sintaxe de link (`[`, `]`, `|`).
 */
export function seedBodyWithParent(parentTitle: string | null | undefined): string {
  const title = (parentTitle ?? '').trim();
  if (!title || /[[\]|]/.test(title)) return '';
  return `[[^${title}]]\n\n`;
}
