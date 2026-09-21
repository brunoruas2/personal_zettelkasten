// Client-side Mermaid rendering via build IIFE vendorizado em
// apps/web/public/vendor/mermaid/ (mermaid.min.js, versão fixa), injetado como
// <script> clássico na primeira necessidade e exposto em `window.mermaid`.
//
// Fica fora do webpack de propósito: `import('mermaid')` no grafo do build
// estourava o heap da VPS (500 MB de RAM). O arquivo é precacheado pelo
// Service Worker (worker/index.ts), então renderiza offline após o primeiro uso.
//
// O container do diagrama é `bg-zinc-100` em claro e escuro, então o tema é
// sempre claro; só o accent do app (`--color-brand`) varia.

type MermaidApi = {
  initialize: (config: Record<string, unknown>) => void;
  render: (id: string, code: string) => Promise<{ svg: string }>;
};

const MERMAID_JS_URL = '/vendor/mermaid/mermaid.min.js';
const DEFAULT_TRIPLET = '124 58 237';

let mermaidPromise: Promise<MermaidApi> | null = null;
let initializedFor: string | null = null;
let seq = 0;

function loadMermaid(): Promise<MermaidApi> {
  if (!mermaidPromise) {
    mermaidPromise = new Promise<MermaidApi>((resolve, reject) => {
      const existing = (window as unknown as { mermaid?: MermaidApi }).mermaid;
      if (existing) {
        resolve(existing);
        return;
      }
      const script = document.createElement('script');
      script.src = MERMAID_JS_URL;
      script.onload = () => {
        const api = (window as unknown as { mermaid?: MermaidApi }).mermaid;
        if (api) resolve(api);
        else reject(new Error('mermaid global not found'));
      };
      script.onerror = () => reject(new Error('failed to load mermaid.min.js'));
      document.head.appendChild(script);
    }).catch((err) => {
      // Sem isso uma falha de rede ficaria memorizada até o reload da página.
      mermaidPromise = null;
      throw err;
    });
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
        theme: 'default',
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
