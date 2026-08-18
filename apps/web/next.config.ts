import type { NextConfig } from 'next';
import withPWA from '@ducanh2912/next-pwa';

const apiUrl = process.env.API_URL ?? 'http://localhost:3001';

const nextConfig: NextConfig = {
  transpilePackages: [
    '@zettelkasten/core',
    '@zettelkasten/db-web',
    'graphology',
    'graphology-layout-forceatlas2',
  ],
  // Skip type-check and lint during build — the VPS (500 MB RAM) runs out of
  // memory on these phases. Types are checked locally before every commit.
  typescript: { ignoreBuildErrors: true },
  eslint: { ignoreDuringBuilds: true },
  // Proxy /api/* to the Go backend — same pattern used by Nginx in production.
  // The browser always talks to the same origin, so no CORS needed.
  async rewrites() {
    return [
      {
        source: '/api/:path*',
        destination: `${apiUrl}/api/:path*`,
      },
    ];
  },
};

export default withPWA({
  dest: 'public',
  disable: process.env.NODE_ENV === 'development',
  // worker/index.ts is prepended before Workbox code and intercepts ALL
  // navigation requests directly — fallbacks.document is not used because
  // our custom worker handles offline navigation with caches.match + redirect.
  // Omitting fallbacks avoids the importScripts('fallback-*.js') call that
  // breaks when the generated file is served behind a redirect (Nginx 404 → /).
  customWorkerSrc: 'worker',
  // The custom worker already caches '/' in SHELL_CACHE on install.
  // Disabling cacheStartUrl prevents next-pwa from generating a NetworkFirst
  // route for '/' with a cacheWillUpdate plugin that references SWC helpers
  // (_async_to_generator, _ts_generator) not available in the SW scope.
  cacheStartUrl: false,
})(nextConfig);
