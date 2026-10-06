/// <reference lib="webworker" />
// Custom additions to the Workbox service worker.
// @ducanh2912/next-pwa prepends this file before the generated Workbox code,
// so our fetch handler takes precedence for navigation requests.

export {}; // make this a module so 'self' refers to ServiceWorkerGlobalScope
declare const self: ServiceWorkerGlobalScope;

const SHELL_CACHE = 'zettelkasten-shell-v1';
// Routes cache is cleared on every SW install so stale HTML (old JS bundle
// hashes after a deploy) is never served.
const ROUTES_CACHE = 'zettelkasten-routes-v1';
// Fora do prefixo 'zettelkasten-shell-' para o activate não apagá-lo.
const EXCALIDRAW_CACHE = 'zettelkasten-excalidraw-v1';
const EXCALIDRAW_BASE = '/vendor/excalidraw/';

// Pre-cache the app shell on every SW install/update.
// Also clear the routes cache so stale zettel HTML is replaced after a deploy.
self.addEventListener('install', (event) => {
  event.waitUntil(
    Promise.all([
      caches
        .open(SHELL_CACHE)
        .then((cache) => cache.addAll(['/', '/vendor/plantuml/plantuml.js', '/vendor/plantuml/viz-global.js'])),
      // Mermaid é grande (~5 MB) e opcional: uma falha de rede aqui não pode
      // derrubar a instalação do SW, então fica fora do addAll atômico acima.
      caches
        .open(SHELL_CACHE)
        .then((cache) => cache.add('/vendor/mermaid/mermaid.min.js'))
        .catch(() => undefined),
      precacheExcalidraw(),
      caches.delete(ROUTES_CACHE),
    ]),
  );
});

// Excalidraw vendorizado: ~200 arquivos (chunks ESM + fontes), listados em
// manifest.json pelo build de tools/excalidraw-vendor. Cache próprio e
// recriado a cada install (os nomes dos chunks mudam com a versão). Fora do
// addAll atômico do shell: falha de rede aqui não pode derrubar a instalação.
async function precacheExcalidraw(): Promise<void> {
  try {
    await caches.delete(EXCALIDRAW_CACHE);
    const cache = await caches.open(EXCALIDRAW_CACHE);
    const manifestUrl = `${EXCALIDRAW_BASE}manifest.json`;
    const res = await fetch(manifestUrl);
    if (!res.ok) return;
    const { files } = (await res.clone().json()) as { files: string[] };
    await cache.put(manifestUrl, res);
    for (let i = 0; i < files.length; i += 8) {
      await Promise.all(
        files.slice(i, i + 8).map((f) => cache.add(`${EXCALIDRAW_BASE}${f}`).catch(() => undefined)),
      );
    }
  } catch {
    // ignore: o runtime caching do Workbox ainda cobre o que for carregado online
  }
}

// Serve os assets do Excalidraw do cache próprio (cache-first), caindo na rede.
self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const { pathname } = new URL(request.url);
  if (!pathname.startsWith(EXCALIDRAW_BASE)) return;
  event.respondWith(
    caches.match(request, { cacheName: EXCALIDRAW_CACHE }).then((hit) => hit ?? fetch(request)),
  );
});

// Remove stale shell caches on activate.
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((k) => k.startsWith('zettelkasten-shell-') && k !== SHELL_CACHE)
          .map((k) => caches.delete(k)),
      ),
    ),
  );
});

// Intercept hard navigation requests (full page load, PWA launch, window.location.href).
//
// Strategy:
//   Online  → fetch from network AND cache the response in ROUTES_CACHE for
//             offline use later (every visited page becomes available offline).
//   Offline → serve from ROUTES_CACHE or SHELL_CACHE.
//             If nothing is cached, serve the app shell HTML directly.
//
// Why we do NOT use Response.redirect('/', 302) as a fallback:
//   On iOS Safari in standalone PWA mode, the browser does NOT re-route the
//   redirect back through the service worker — it makes a bare network request
//   to '/' which fails in airplane mode and shows the native "Safari cannot
//   open the page because the iPhone is not connected to the internet" alert.
//   Serving the shell HTML directly avoids this iOS Safari bug entirely.
//
// Why we search only our own caches (not caches.match without a cacheName):
//   Workbox also caches requests at zettel URLs — in particular the RSC payload
//   (Content-Type: text/x-component) for soft navigation. A bare caches.match()
//   may return that RSC response instead of HTML, causing a blank/broken page.
self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.mode !== 'navigate') return;

  const { pathname } = new URL(request.url);
  // Let API requests go through normally (they have their own error handling).
  if (pathname.startsWith('/api/')) return;

  event.respondWith(
    fetch(request)
      .then(async (response) => {
        // Cache every successfully loaded HTML page for offline use.
        // Skip non-OK, redirects, and opaque (cross-origin) responses.
        if (response.ok && response.type === 'basic') {
          const cache = await caches.open(ROUTES_CACHE);
          // Fire-and-forget: don't delay the response for caching
          cache.put(request, response.clone()).catch(() => {
            // ignore QuotaExceededError and other storage errors
          });
        }
        return response;
      })
      .catch(async () => {
        // Network failed (offline).
        // Search only our managed caches to avoid accidentally serving an RSC
        // payload (text/x-component) that Workbox cached at the same URL.
        const cached =
          (await caches.match(request, { cacheName: ROUTES_CACHE })) ??
          (await caches.match(request, { cacheName: SHELL_CACHE }));
        if (cached) return cached;

        // Route not in any of our caches.
        // Serve the app shell directly — Next.js will soft-navigate to the
        // correct route client-side using IndexedDB data + Workbox-cached RSC
        // payloads from previous online visits.
        const shell =
          (await caches.match('/', { cacheName: SHELL_CACHE })) ??
          (await caches.match('/', { cacheName: ROUTES_CACHE }));
        if (shell) return shell;

        // Last resort: should never be reached if the install event succeeded.
        return new Response(
          '<!doctype html><html><body><p>Offline — abra o app quando estiver conectado para carregar o conteúdo.</p></body></html>',
          { headers: { 'Content-Type': 'text/html; charset=utf-8' } },
        );
      }),
  );
});
