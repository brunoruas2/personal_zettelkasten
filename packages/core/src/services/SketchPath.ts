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

/** Desvio máximo (unidades da grade, por eixo) do controle implícito de um `t` antes de virar `q` explícito. */
const MAX_CTRL_DRIFT = 1;

/**
 * Mesma geometria de `outlineToSvgPath`, para o preview SVG gravado: `M` absoluto
 * e o resto em comandos relativos (`q`, `t`, `l`, `z`) com deltas inteiros, numa
 * grade de `unit` subdivisões por px (as coordenadas saem multiplicadas por `unit`;
 * quem monta o SVG desfaz com `scale(1/unit)`). Cada coordenada absoluta é
 * arredondada **antes** do delta, então o erro por ponto fica em até 0,5 unidade
 * e não se acumula ao longo do traço. Com `unit = 1` o degrau de 0,5 px aparece
 * como ondulação no preview ampliado; o `sceneToSvg` usa 4 (¼ px).
 *
 * O `t` não carrega controle: o SVG o calcula refletindo o anterior no ponto
 * corrente, e com fins arredondados esse reflexo deriva (o erro de cada passo soma
 * no seguinte — chegava a 15 px e hachurava o traço). Por isso o controle implícito
 * é acompanhado no espaço quantizado: enquanto fica a até `MAX_CTRL_DRIFT` do
 * vértice arredondado sai `t`; senão sai `q` com o controle explícito, e os `t`
 * seguintes refletem a partir dele. O canvas não usa isto: no zoom do editor, 1 px
 * de passo serrilharia o traço.
 */
export function outlineToCompactSvgPath(
  outline: ReadonlyArray<ReadonlyArray<number>>,
  unit = 1,
): string {
  const len = outline.length;
  if (len < 2) return '';

  let cx = Math.round(outline[0][0] * unit);
  let cy = Math.round(outline[0][1] * unit);
  // Delta até (x, y) quantizado na grade; avança o ponto corrente.
  const step = (x: number, y: number): [number, number] => {
    const qx = Math.round(x * unit);
    const qy = Math.round(y * unit);
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

  // Comandos consecutivos da mesma letra compartilham a letra (`t1,2,3,4` = dois `t`).
  let cmd = '';
  let nums: number[] = [];
  const flush = () => {
    if (nums.length > 0) d += cmd + joinNums(nums);
    nums = [];
  };
  const emit = (letter: string, values: number[]) => {
    if (letter !== cmd) {
      flush();
      cmd = letter;
    }
    nums.push(...values);
  };

  // Controle (absoluto, quantizado) da última curva, como o SVG o enxerga.
  let icx = 0;
  let icy = 0;
  for (let i = 1; i < len - 1; i++) {
    const p = outline[i];
    const q = outline[i + 1];
    const vx = Math.round(p[0] * unit);
    const vy = Math.round(p[1] * unit);
    const rx = 2 * cx - icx;
    const ry = 2 * cy - icy;
    if (i > 1 && Math.abs(rx - vx) <= MAX_CTRL_DRIFT && Math.abs(ry - vy) <= MAX_CTRL_DRIFT) {
      icx = rx;
      icy = ry;
      emit('t', step(mid(p[0], q[0]), mid(p[1], q[1])));
    } else {
      // No `q`, controle e fim são relativos ao início do segmento.
      const ctrl = [vx - cx, vy - cy];
      icx = vx;
      icy = vy;
      emit('q', [...ctrl, ...step(mid(p[0], q[0]), mid(p[1], q[1]))]);
    }
  }
  flush();
  return d + 'z';
}
