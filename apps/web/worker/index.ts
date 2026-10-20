/// <reference lib="webworker" />
// Custom additions to the Workbox service worker.
// @ducanh2912/next-pwa prepends this file before the generated Workbox code,
// so our fetch handler takes precedence for navigation requests.

export {}; // make this a module so 'self' refers to ServiceWorkerGlobalScope
declare const self: ServiceWorkerGlobalScope;

const SHELL_CACHE = 'zettelkasten-shell-v1';
// Cache de HTML por rota da era das páginas por zettel (`/zettel/:id`). A
// galáxia é uma rota só (o shell); o activate apaga o que ficou em quem já
// tinha instalado.
const LEGACY_ROUTES_CACHE = 'zettelkasten-routes-v1';
// Cache do antigo editor de desenho (Excalidraw vendorizado, ~7 MB). O editor foi
// trocado por um canvas próprio; o activate apaga o que ficou em quem já instalou.
const LEGACY_EXCALIDRAW_CACHE = 'zettelkasten-excalidraw-v1';

// Pre-cache the app shell on every SW install/update.
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
    ]),
  );
});

// Remove stale shell caches on activate (and the legacy Excalidraw and
// per-route caches).

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter(
            (k) =>
              (k.startsWith('zettelkasten-shell-') && k !== SHELL_CACHE) ||
              k === LEGACY_EXCALIDRAW_CACHE ||
              k === LEGACY_ROUTES_CACHE,
          )
          .map((k) => caches.delete(k)),
      ),
    ),
  );
});

// Intercept hard navigation requests (full page load, PWA launch, window.location.href).
//
// Strategy:
//   Online  → fetch from network. A successful load of `/` (the galaxy, with
//             or without `?z=`) refreshes the shell copy, so the offline shell
//             follows deploys. Nothing is cached per URL — `?z=<id>` would
//             otherwise create one entry per zettel.
//   Offline → serve the shell (`/`) for any navigation; the galaxy renders
//             from IndexedDB. If nothing is cached, serve a minimal HTML.
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
        // Skip non-OK, redirects, and opaque (cross-origin) responses.
        if (pathname === '/' && response.ok && response.type === 'basic' && !response.redirected) {
          const cache = await caches.open(SHELL_CACHE);
          // Fire-and-forget: don't delay the response for caching
          cache.put('/', response.clone()).catch(() => {
            // ignore QuotaExceededError and other storage errors
          });
        }
        return response;
      })
      .catch(async () => {
        // Network failed (offline).
        // Search only our managed caches to avoid accidentally serving an RSC
        // payload (text/x-component) that Workbox cached at the same URL.
        // Any route offline → the galaxy shell (old links like /zettel/:id
        // included: their redirect is server-side).
        const shell = await caches.match('/', { cacheName: SHELL_CACHE });
        if (shell) return shell;

        // Last resort: should never be reached if the install event succeeded.
        return new Response(
          '<!doctype html><html><body><p>Offline — abra o app quando estiver conectado para carregar o conteúdo.</p></body></html>',
          { headers: { 'Content-Type': 'text/html; charset=utf-8' } },
        );
      }),
  );
});
