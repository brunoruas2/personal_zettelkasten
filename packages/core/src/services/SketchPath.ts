const f = (n: number) => n.toFixed(2);
const mid = (a: number, b: number) => (a + b) / 2;

/**
 * Polígono do outline (o que `perfect-freehand` devolve) → `d` de um path fechado,
 * com curvas quadráticas que passam pelos pontos médios das arestas. Menos de 2
 * pontos não desenha nada; 2 e 3 pontos viram polígono reto.
 */
export function outlineToSvgPath(outline: ReadonlyArray<ReadonlyArray<number>>): string {
  const len = outline.length;
  if (len < 2) return '';
  if (len < 4) {
    return `M${f(outline[0][0])},${f(outline[0][1])}` +
      outline
        .slice(1)
        .map((p) => ` L${f(p[0])},${f(p[1])}`)
        .join('') +
      ' Z';
  }

  const a = outline[0];
  const b = outline[1];
  const c = outline[2];
  let d = `M${f(a[0])},${f(a[1])} Q${f(b[0])},${f(b[1])} ${f(mid(b[0], c[0]))},${f(mid(b[1], c[1]))} T`;
  for (let i = 2; i < len - 1; i++) {
    const p = outline[i];
    const q = outline[i + 1];
    d += `${f(mid(p[0], q[0]))},${f(mid(p[1], q[1]))} `;
  }
  return d + 'Z';
}
