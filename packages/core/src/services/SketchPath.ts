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

/** Números de um path compacto: `,` só antes de não negativo (o `-` já separa). */
function joinNums(nums: number[]): string {
  let s = '';
  for (let i = 0; i < nums.length; i++) {
    const n = nums[i];
    if (i > 0 && n >= 0) s += ',';
    s += String(n === 0 ? 0 : n); // sem "-0"
  }
  return s;
}

/**
 * Mesma geometria de `outlineToSvgPath`, para o preview SVG gravado: `M` absoluto
 * e o resto em comandos relativos (`q`, `t`, `l`, `z`) com deltas inteiros. Cada
 * coordenada absoluta é arredondada **antes** do delta, então o erro por ponto
 * fica em até 0,5 px e não se acumula ao longo do traço. O canvas não usa isto:
 * no zoom do editor, 1 px de passo serrilharia o traço.
 */
export function outlineToCompactSvgPath(outline: ReadonlyArray<ReadonlyArray<number>>): string {
  const len = outline.length;
  if (len < 2) return '';

  let cx = Math.round(outline[0][0]);
  let cy = Math.round(outline[0][1]);
  // Delta até (x, y) quantizado; avança o ponto corrente.
  const step = (x: number, y: number): [number, number] => {
    const qx = Math.round(x);
    const qy = Math.round(y);
    const delta: [number, number] = [qx - cx, qy - cy];
    cx = qx;
    cy = qy;
    return delta;
  };

  let d = `M${joinNums([cx, cy])}`;
  if (len < 4) {
    const nums: number[] = [];
    for (let i = 1; i < len; i++) nums.push(...step(outline[i][0], outline[i][1]));
    return `${d}l${joinNums(nums)}z`;
  }

  const b = outline[1];
  const c = outline[2];
  // No `q`, controle e fim são relativos ao início do segmento.
  const ctrl = [Math.round(b[0]) - cx, Math.round(b[1]) - cy];
  const end = step(mid(b[0], c[0]), mid(b[1], c[1]));
  d += `q${joinNums([...ctrl, ...end])}`;

  const ts: number[] = [];
  for (let i = 2; i < len - 1; i++) {
    const p = outline[i];
    const q = outline[i + 1];
    ts.push(...step(mid(p[0], q[0]), mid(p[1], q[1])));
  }
  if (ts.length > 0) d += `t${joinNums(ts)}`;
  return d + 'z';
}
