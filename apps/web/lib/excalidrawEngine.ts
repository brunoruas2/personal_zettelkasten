// Excalidraw vendorizado em apps/web/public/vendor/excalidraw/ (gerado por
// tools/excalidraw-vendor, versão travada) e carregado como módulo ESM via
// `import()` na primeira necessidade — só quando o editor de desenho abre.
//
// Fica fora do webpack de propósito: `import('@excalidraw/excalidraw')` no grafo
// do build estourava o heap da VPS (500 MB de RAM, `--max-old-space-size=384`),
// como aconteceu com o Mermaid. O bundle expõe `window.ZkExcalidraw`; este
// módulo nunca importa `@excalidraw/*`. Sem CDN: fontes e locales saem do
// próprio origin via `EXCALIDRAW_ASSET_PATH`. O Service Worker precacheia tudo
// (worker/index.ts), então abre offline após o primeiro uso.

export type ExcalidrawTheme = 'light' | 'dark';

export interface ExcalidrawChangeInfo {
  version: number;
  empty: boolean;
}

export interface ExcalidrawMountOptions {
  /** JSON string de uma cena salva, ou null para cena vazia. */
  scene?: string | null;
  theme?: ExcalidrawTheme;
  langCode?: string;
  onChange?: (info: ExcalidrawChangeInfo) => void;
}

export interface ExcalidrawExport {
  svg: string;
  width: number;
  height: number;
}

export interface ExcalidrawHandle {
  destroy(): void;
  /** Cena serializada como JSON (`type: "excalidraw"`). */
  getScene(): string;
  /** Rejeita com `empty-scene` se não houver elementos. */
  exportSvg(opts?: { dark?: boolean }): Promise<ExcalidrawExport>;
  setTheme(theme: ExcalidrawTheme): void;
  setPenMode(on: boolean): void;
  isEmpty(): boolean;
  version(): number;
}

interface ZkExcalidrawApi {
  mount(el: HTMLElement, opts?: ExcalidrawMountOptions): ExcalidrawHandle;
}

const ASSET_PATH = '/vendor/excalidraw/';
const ENGINE_URL = `${ASSET_PATH}excalidraw.js`;
const CSS_URL = `${ASSET_PATH}excalidraw.css`;

let enginePromise: Promise<ZkExcalidrawApi> | null = null;

function ensureCss(): void {
  if (document.querySelector('link[data-zk-excalidraw]')) return;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = CSS_URL;
  link.setAttribute('data-zk-excalidraw', '');
  document.head.appendChild(link);
}

export function loadExcalidraw(): Promise<ZkExcalidrawApi> {
  if (!enginePromise) {
    enginePromise = (async () => {
      const w = window as unknown as {
        EXCALIDRAW_ASSET_PATH?: string;
        EXCALIDRAW_THROTTLE_RENDER?: boolean;
        ZkExcalidraw?: ZkExcalidrawApi;
      };
      // Antes da carga: o Excalidraw lê o caminho de fontes/locales na inicialização.
      w.EXCALIDRAW_ASSET_PATH = ASSET_PATH;
      // Sem isto cada pointermove dispara um render síncrono do canvas inteiro; com
      // mouse/caneta de alta taxa (Firefox/Zen principalmente) os renders se acumulam
      // e o traço atrasa. Ligado, o Excalidraw agrupa os renders por frame.
      w.EXCALIDRAW_THROTTLE_RENDER = true;
      ensureCss();
      if (!w.ZkExcalidraw) {
        await import(/* webpackIgnore: true */ ENGINE_URL);
      }
      if (!w.ZkExcalidraw) throw new Error('ZkExcalidraw global not found');
      return w.ZkExcalidraw;
    })().catch((err) => {
      // Sem isso uma falha de rede ficaria memorizada até o reload da página.
      enginePromise = null;
      throw err;
    });
  }
  return enginePromise;
}

export async function mountExcalidraw(
  el: HTMLElement,
  opts?: ExcalidrawMountOptions,
): Promise<ExcalidrawHandle> {
  const api = await loadExcalidraw();
  return api.mount(el, opts);
}
