import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright config for offline/PWA E2E tests.
 *
 * Requires a production build (SW is disabled in dev mode):
 *   pnpm --filter @zettelkasten/web build
 *   pnpm --filter @zettelkasten/web test:e2e
 *
 * Or in one shot:
 *   pnpm --filter @zettelkasten/web test:e2e:build
 *
 * Two servers are started automatically:
 *  - Next.js (port 3000) — the actual app
 *  - Mock Go API (port 3001) — so Next.js's /api/* proxy resolves
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: false, // SW tests are stateful — run sequentially
  retries: process.env.CI ? 1 : 0,
  reporter: 'list',
  use: {
    baseURL: 'http://localhost:3000',
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'mobile-chrome',
      use: { ...devices['Pixel 5'] },
    },
  ],
  webServer: [
    {
      // Mock Go API — must start before Next.js (Next.js proxies /api/* to it)
      command: 'node e2e/mock-api.mjs',
      port: 3001,
      reuseExistingServer: !process.env.CI,
      timeout: 10_000,
    },
    {
      // Next.js production server (requires `next build` to have been run)
      command: 'pnpm start',
      port: 3000,
      reuseExistingServer: !process.env.CI,
      timeout: 30_000,
    },
  ],
});
