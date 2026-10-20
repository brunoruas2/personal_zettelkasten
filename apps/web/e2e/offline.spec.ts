/**
 * Offline / PWA E2E tests.
 *
 * Requires a production build (SW is disabled in dev mode):
 *   pnpm --filter @zettelkasten/web build
 *   pnpm --filter @zettelkasten/web test:e2e
 *
 * What is being tested:
 *  1. The service worker activates and takes control of the page.
 *  2. Offline, the galaxy (`/`, the only app route) loads from the shell cache.
 *  3. Offline, an old link (`/zettel/:id`) falls back to the shell instead of
 *     a native network error, and the legacy per-route cache is gone.
 *  4. After an online session, the galaxy renders the zettel's card from
 *     IndexedDB when offline (`/?z=<id>` flies to it).
 *
 * The e2e/mock-api.mjs server handles Go API calls (port 3001) so that:
 *  - AuthProvider can authenticate (POST /api/auth/refresh)
 *  - SyncService can pull the test zettel (GET /api/zettels, /bodies, /positions)
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
  test('galaxy loads from the shell cache when offline', async ({ page, context }) => {
    await bypassMiddleware(context);
    await page.goto('/');
    await waitForSwController(page);

    await context.setOffline(true);
    await page.reload();

    await expect(page.locator('body')).toBeVisible({ timeout: 15_000 });
    const title = await page.title();
    expect(title).not.toMatch(/ERR_|not available|no internet/i);
  });

  test('old zettel link falls back to the shell (not a native error) when offline', async ({
    page,
    context,
  }) => {
    await bypassMiddleware(context);
    await page.goto('/');
    await waitForSwController(page);

    // The per-route cache of the old pages must not exist anymore.
    const hasLegacyCache = await page.evaluate(() => caches.has('zettelkasten-routes-v1'));
    expect(hasLegacyCache).toBe(false);

    await context.setOffline(true);

    let navError: Error | null = null;
    try {
      await page.goto(`/zettel/${TEST_ZETTEL_ID}`);
    } catch (e) {
      navError = e as Error;
    }

    expect(navError, 'Navigation to an old route should NOT throw').toBeNull();
    await expect(page.locator('body')).toBeVisible();
    const bodyText = await page.locator('body').textContent();
    expect(bodyText).not.toMatch(/ERR_INTERNET_DISCONNECTED|net::ERR/i);
  });
});

test.describe('Full offline flow', () => {
  test('zettel card renders from IndexedDB when offline', async ({ page, context }) => {
    // --- Online phase: authenticate, sync index, positions and bodies ---
    await bypassMiddleware(context);
    await page.goto('/');
    await waitForSwController(page);
    await waitForAppReady(page);

    await page.waitForFunction(
      () => {
        const v = localStorage.getItem('zettel_last_sync_at');
        return v !== null && v !== '0';
      },
      { timeout: 30_000 },
    );

    // Index, body and position in IndexedDB. Open without a version number —
    // Dexie uses internal versioning.
    const stored = await page.evaluate(async (id) => {
      const db = await new Promise<IDBDatabase | null>((resolve) => {
        const req = indexedDB.open('zettelkasten');
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => resolve(null);
      });
      if (!db) return { meta: false, body: false, position: false };
      const has = (store: string) =>
        new Promise<boolean>((resolve) => {
          if (!db.objectStoreNames.contains(store)) return resolve(false);
          const get = db.transaction(store, 'readonly').objectStore(store).get(id);
          get.onsuccess = () => resolve(!!get.result);
          get.onerror = () => resolve(false);
        });
      return { meta: await has('zettels'), body: await has('bodies'), position: await has('positions') };
    }, TEST_ZETTEL_ID);

    expect(stored.meta, 'meta should be in IndexedDB').toBe(true);
    await expect
      .poll(
        () =>
          page.evaluate(async (id) => {
            const db = await new Promise<IDBDatabase>((resolve) => {
              const req = indexedDB.open('zettelkasten');
              req.onsuccess = () => resolve(req.result);
            });
            return new Promise<boolean>((resolve) => {
              const get = db.transaction('bodies', 'readonly').objectStore('bodies').get(id);
              get.onsuccess = () => resolve(!!get.result);
              get.onerror = () => resolve(false);
            });
          }, TEST_ZETTEL_ID),
        { timeout: 30_000 },
      )
      .toBe(true);

    // --- Offline phase ---
    await context.setOffline(true);

    let navError: Error | null = null;
    try {
      await page.goto(`/?z=${TEST_ZETTEL_ID}`);
    } catch (e) {
      navError = e as Error;
    }
    expect(navError, 'Offline navigation should not throw').toBeNull();

    // `?z=` lands at card zoom: the card title renders from IndexedDB.
    await expect(page.locator('[data-galaxy-card] h3', { hasText: 'Zettel Offline Test' }))
      .toBeVisible({ timeout: 15_000 });
  });
});
