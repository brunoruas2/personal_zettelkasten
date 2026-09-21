// Client-side Mermaid rendering. O módulo é carregado por import dinâmico:
// quem não tem bloco Mermaid nunca baixa o chunk.
//
// O container do diagrama é `bg-white` em claro e escuro, então o tema é
// sempre claro; só o accent do app (`--color-brand`) varia.

type MermaidApi = typeof import('mermaid').default;

const DEFAULT_TRIPLET = '124 58 237';

let mermaidPromise: Promise<MermaidApi> | null = null;
let initializedFor: string | null = null;
let seq = 0;

function loadMermaid(): Promise<MermaidApi> {
  if (!mermaidPromise) {
    mermaidPromise = import('mermaid').then((m) => m.default);
  }
  return mermaidPromise;
}

/** Chave do tema atual: o accent em uso ("124 58 237"). Entra na chave do cache de SVG. */
export function mermaidThemeKey(): string {
  try {
    return getComputedStyle(document.documentElement).getPropertyValue('--color-brand').trim() || DEFAULT_TRIPLET;
  } catch {
    return DEFAULT_TRIPLET;
  }
}

function tripletToHex(triplet: string): string {
  const [r, g, b] = triplet.split(/\s+/).map((n) => Math.max(0, Math.min(255, Number(n) || 0)));
  return '#' + [r, g, b].map((n) => n.toString(16).padStart(2, '0')).join('');
}

// Serializa os renders: o Mermaid injeta um nó temporário no DOM por id, e
// `initialize` é global — trocar o accent no meio de um render vizinho o corromperia.
let queue: Promise<unknown> = Promise.resolve();

export function renderMermaid(code: string, themeKey: string): Promise<string> {
  const run = async () => {
    const mermaid = await loadMermaid();
    if (initializedFor !== themeKey) {
      mermaid.initialize({
        startOnLoad: false,
        // O texto vem do conteúdo do zettel e o SVG entra por innerHTML.
        securityLevel: 'strict',
        // Não desenha o balão de erro no <body>; o MermaidBlock mostra o source.
        suppressErrorRendering: true,
        theme: 'base',
        themeVariables: { primaryColor: tripletToHex(themeKey) },
      });
      initializedFor = themeKey;
    }
    const id = `zk-mermaid-${++seq}`;
    try {
      const { svg } = await mermaid.render(id, code);
      return svg;
    } finally {
      // Em falha o Mermaid pode deixar o nó temporário para trás.
      document.getElementById(id)?.remove();
      document.getElementById(`d${id}`)?.remove();
    }
  };

  const result = queue.then(run);
  queue = result.catch(() => undefined);
  return result;
}
