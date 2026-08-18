// Client-side PlantUML rendering via the vendored @plantuml/core engine
// (apps/web/public/vendor/plantuml/). Two files are involved:
//   - viz-global.js: classic script, Graphviz/Viz.js layout engine. Must be
//     loaded and attached to `window` before plantuml.js runs.
//   - plantuml.js: ES module (TeaVM-compiled), exports render/renderToString.
// The engine keeps shared internal state across calls, so concurrent
// renders on the same page must be serialized — see `queue` below.

type PlantUmlModule = {
  renderToString: (
    lines: string[],
    onSuccess: (svg: string) => void,
    onError: (message: string) => void,
  ) => void;
};

let vizGlobalPromise: Promise<void> | null = null;
let plantUmlModulePromise: Promise<PlantUmlModule> | null = null;

function loadVizGlobal(): Promise<void> {
  if (!vizGlobalPromise) {
    vizGlobalPromise = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = '/vendor/plantuml/viz-global.js';
      script.onload = () => resolve();
      script.onerror = () => reject(new Error('failed to load viz-global.js'));
      document.head.appendChild(script);
    });
  }
  return vizGlobalPromise;
}

// Not a string literal: keeps TypeScript from trying (and failing) to
// resolve this as a module specifier, since it's a public URL, not a
// package. webpackIgnore keeps Next.js's bundler from doing the same.
const PLANTUML_JS_URL = '/vendor/plantuml/plantuml.js';

function loadPlantUmlModule(): Promise<PlantUmlModule> {
  if (!plantUmlModulePromise) {
    plantUmlModulePromise = loadVizGlobal().then(
      () => import(/* webpackIgnore: true */ PLANTUML_JS_URL) as Promise<PlantUmlModule>,
    );
  }
  return plantUmlModulePromise;
}

// Serializes all renders through a single promise chain — the engine
// silently overwrites in-flight results if called concurrently.
let queue: Promise<unknown> = Promise.resolve();

export function renderPlantUml(source: string): Promise<string> {
  const run = () =>
    loadPlantUmlModule().then(
      ({ renderToString }) =>
        new Promise<string>((resolve, reject) => {
          const lines = source.split(/\r\n|\r|\n/);
          renderToString(lines, resolve, (message) => reject(new Error(message)));
        }),
    );

  const result = queue.then(run);
  // Keep the chain alive regardless of this call's outcome, so one failed
  // render doesn't block the next one from starting. `queue` itself never
  // rejects, which is why `.then(run)` above needs no rejection handler.
  queue = result.catch(() => undefined);
  return result;
}
