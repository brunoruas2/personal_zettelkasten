/**
 * Minimal mock Go API server for Playwright E2E tests.
 * Runs on port 3001 so Next.js proxy rewrites (/api/* → localhost:3001) resolve.
 *
 * Returns just enough data for the app to authenticate, sync, and cache routes.
 */

import { createServer } from 'node:http';

const PORT = 3001;

const MOCK_USER = { id: 'u1', username: 'testuser', role: 'member' };

const MOCK_ZETTEL = {
  id: 'test20260101120000',
  user_id: 'u1',
  title: 'Zettel Offline Test',
  body: 'Corpo do zettel para teste offline.',
  tags: ['teste'],
  created_at: 1704067200000,
  updated_at: 1704067200000,
  deleted_at: null,
};

function json(res, data, status = 200) {
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type,Authorization',
  });
  res.end(JSON.stringify(data));
}

const server = createServer((req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const path = url.pathname;
  const method = req.method;

  // CORS preflight
  if (method === 'OPTIONS') {
    res.writeHead(204, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type,Authorization' });
    res.end();
    return;
  }

  // Auth endpoints
  if (path === '/api/auth/refresh' && method === 'POST') {
    // Also set the refresh_token cookie in the response so the browser keeps it
    res.setHeader('Set-Cookie', 'refresh_token=mock-refresh-token; Path=/; HttpOnly; SameSite=Lax');
    return json(res, { access_token: 'mock-access-token' });
  }
  if (path === '/api/auth/me' && method === 'GET') {
    return json(res, MOCK_USER);
  }
  if (path === '/api/auth/logout' && method === 'POST') {
    return json(res, {});
  }

  // Zettels
  if (path === '/api/zettels' && method === 'GET') {
    return json(res, [MOCK_ZETTEL]);
  }
  if (path.startsWith('/api/zettels') && method === 'GET') {
    // Includes ?since= queries
    return json(res, [MOCK_ZETTEL]);
  }
  if (path.startsWith('/api/zettels') && (method === 'POST' || method === 'PUT' || method === 'DELETE')) {
    return json(res, {});
  }

  // Links
  if (path === '/api/links' && method === 'GET') {
    return json(res, []);
  }

  // Imagens — o prefetch roda depois de todo sync, então precisa de manifesto
  // vazio para não poluir o log dos testes offline.
  if (path === '/api/images/manifest' && method === 'GET') {
    return json(res, { images: [], used_bytes: 0, quota_bytes: 250 * 1024 * 1024 });
  }
  if (path.startsWith('/api/images/') && method === 'GET') {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ error: 'not found' }));
  }
  if (path.startsWith('/api/images/') && (method === 'POST' || method === 'DELETE')) {
    return json(res, {});
  }

  // Admin / invites / passkeys — default empty OK
  json(res, {});
});

server.listen(PORT, () => {
  console.log(`Mock API server listening on http://localhost:${PORT}`);
});
