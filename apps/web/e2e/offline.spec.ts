/**
 * Offline / PWA E2E tests.
 *
 * Requires a production build (SW is disabled in dev mode):
 *   pnpm --filter @zettelkasten/web build
 *   pnpm --filter @zettelkasten/web test:e2e
 *
 * What is being tested:
 *  1. The service worker activates and takes control of the page.
 *  2. Navigation requests are cached in ROUTES_CACHE on first online visit.
 *  3. When offline, navigating to a cached page does NOT throw a network error
 *     (the SW must serve HTML from cache, not Response.error() or a broken redirect).
 *  4. When offline, the app shell loads for uncached routes (no native iOS error).
 *  5. After a full online session with real data, the zettel detail page renders
 *     its content from IndexedDB when offline.
 *
 * The e2e/mock-api.mjs server handles Go API calls (port 3001) so that:
 *  - AuthProvider can authenticate (POST /api/auth/refresh)
 *  - SyncService can pull the test zettel (GET /api/zettels)
 *  - Service worker Workbox routes for /api/* get real 200 responses
 */

import { test, expect, type Page, type BrowserContext } from '@playwright/test';

const TEST_ZETTEL_ID = 'test20260101120000';

/**
 * Set the refresh_token cookie so Next.js middleware lets us through to /
 * without redirecting to /login. The actual token validity is checked by
 * AuthProvider (which calls the mock API).
 */
async function bypassMiddleware(context: BrowserContext) {
  await context.addCookies([
    {
      name: 'refresh_token',
      value: 'mock-refresh-token',
      domain: 'localhost',
      path: '/',
      httpOnly: true,
      secure: false,
    },
  ]);
}

/**
 * Wait for the SW to be active and controlling the page.
 * On the very first visit after install, skipWaiting + clientsClaim need a moment.
 */
async function waitForSwController(page: Page) {
  await page.waitForFunction(
    () => !!navigator.serviceWorker.controller,
    { timeout: 30_000 },
  );
}

/**
 * Wait for the app to finish initialising: DatabaseProvider sets ready=true,
 * loading spinner disappears, zettel list (or any content) is visible.
 */
async function waitForAppReady(page: Page) {
  await page.waitForFunction(
    () => document.querySelectorAll('.animate-spin').length === 0,
    { timeout: 30_000 },
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.describe('Service Worker', () => {
  test('SW installs and controls the page after first visit', async ({ page, context }) => {
    await bypassMiddleware(context);
    await page.goto('/');
    await waitForSwController(page);

    const controller = await page.evaluate(
      () => navigator.serviceWorker.controller?.scriptURL ?? null,
    );
    expect(controller).toMatch(/sw\.js/);
  });
});

test.describe('Offline navigation', () => {
  test('home page loads from SW cache when offline', async ({ page, context }) => {
    await bypassMiddleware(context);
    await page.goto('/');
    await waitForSwController(page);

    // Go offline and hard-reload
    await context.setOffline(true);
    await page.reload();

    // Page should load from SW cache — no network error
    await expect(page.locator('body')).toBeVisible({ timeout: 15_000 });
    const title = await page.title();
    expect(title).not.toMatch(/ERR_|not available|no internet/i);
  });

  test('cached zettel page loads without network error when offline', async ({
    page,
    context,
  }) => {
    await bypassMiddleware(context);
    await page.goto('/');
    await waitForSwController(page);

    const zettelUrl = `/zettel/${TEST_ZETTEL_ID}`;

    // Manually put the zettel HTML into ROUTES_CACHE from the page context.
    // This simulates what cacheZettelRoutes() does via the SW message handler,
    // without relying on async timing.
    const cached = await page.evaluate(async (url) => {
      try {
        const response = await fetch(url);
        if (!response.ok) return false;
        const cache = await caches.open('zettelkasten-routes-v1');
        await cache.put(url, response.clone());
        return true;
      } catch {
        return false;
      }
    }, zettelUrl);

    expect(cached, 'Should be able to cache the zettel route while online').toBe(true);

    await context.setOffline(true);

    // Hard navigation — same as window.location.href = zettelUrl
    let navError: Error | null = null;
    try {
      await page.goto(zettelUrl);
    } catch (e) {
      navError = e as Error;
    }

    // SW must serve from ROUTES_CACHE — no network error allowed
    expect(navError, 'Navigation should NOT throw a network error offline').toBeNull();
    await expect(page.locator('body')).toBeVisible();

    const bodyText = await page.locator('body').textContent();
    expect(bodyText).not.toMatch(/ERR_INTERNET_DISCONNECTED|net::ERR/i);
  });

  test('uncached zettel page falls back to app shell (not native error) when offline', async ({
    page,
    context,
  }) => {
    await bypassMiddleware(context);
    await page.goto('/');
    await waitForSwController(page);

    // Navigate to a route that was NEVER cached
    const unknownUrl = `/zettel/nevercached99999`;

    await context.setOffline(true);

    let navError: Error | null = null;
    try {
      await page.goto(unknownUrl);
    } catch (e) {
      navError = e as Error;
    }

    // SW must serve the app shell (not Response.error() and not a broken redirect)
    expect(navError, 'Navigation to uncached route should NOT throw').toBeNull();
    await expect(page.locator('body')).toBeVisible();
  });
});

test.describe('Full offline flow', () => {
  test('zettel content renders from IndexedDB when offline', async ({ page, context }) => {
    // --- Online phase: authenticate, sync, cache ---
    await bypassMiddleware(context);
    await page.goto('/');
    await waitForSwController(page);
    await waitForAppReady(page);

    // Wait until pullAll() has completed: it sets zettel_last_sync_at to a
    // non-zero timestamp after successfully writing server data to IndexedDB.
    await page.waitForFunction(
      () => {
        const v = localStorage.getItem('zettel_last_sync_at');
        return v !== null && v !== '0';
      },
      { timeout: 30_000 },
    );

    // Verify the zettel is in IndexedDB.
    // Open without specifying a version number — Dexie uses internal versioning
    // (v10+), so `open('zettelkasten', 1)` would error on a version mismatch.
    const inDb = await page.evaluate(async (id) => {
      return new Promise<boolean>((resolve) => {
        const req = indexedDB.open('zettelkasten');
        req.onsuccess = (e) => {
          const db = (e.target as IDBOpenDBRequest).result;
          if (!db.objectStoreNames.contains('zettels')) { resolve(false); return; }
          const tx = db.transaction('zettels', 'readonly');
          const getReq = tx.objectStore('zettels').get(id);
          getReq.onsuccess = () => resolve(!!getReq.result);
          getReq.onerror = () => resolve(false);
        };
        req.onerror = () => resolve(false);
      });
    }, TEST_ZETTEL_ID);

    expect(inDb, `Zettel ${TEST_ZETTEL_ID} should be in IndexedDB after pull`).toBe(true);

    const zettelUrl = `/zettel/${TEST_ZETTEL_ID}`;

    // Wait until cacheZettelRoutes() has put the route in the cache.
    // This verifies the auto-caching after login without visiting the page.
    await page.waitForFunction(
      async (url) => {
        const hit = await caches.match(url, { cacheName: 'zettelkasten-routes-v1' });
        return !!hit;
      },
      zettelUrl,
      { timeout: 30_000 },
    );

    // --- Offline phase ---
    await context.setOffline(true);

    let navError: Error | null = null;
    try {
      await page.goto(zettelUrl);
    } catch (e) {
      navError = e as Error;
    }

    expect(navError, 'Offline navigation should not throw').toBeNull();
    await expect(page.locator('body')).toBeVisible();

    // Zettel title must render from IndexedDB
    await expect(page.locator('h1', { hasText: 'Zettel Offline Test' }))
      .toBeVisible({ timeout: 15_000 });
  });
});
