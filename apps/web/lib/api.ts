// Access token kept in memory only — never persisted to localStorage (XSS protection)
let _accessToken: string | null = null
let _onAuthError: (() => void) | null = null
let _refreshing: Promise<string | null> | null = null

// Empty string = same origin. Next.js rewrites /api/* → Go API in dev;
// Nginx does the same in production. No CORS headers needed.
export const API_BASE = ''

export function setAccessToken(token: string | null): void {
  _accessToken = token
}

export function registerAuthErrorHandler(cb: () => void): void {
  _onAuthError = cb
}

export class AuthError extends Error {
  constructor(msg = 'Sessão expirada') {
    super(msg)
    this.name = 'AuthError'
  }
}

async function refreshAccessToken(): Promise<string | null> {
  // Deduplicate concurrent refresh attempts
  if (_refreshing) return _refreshing

  _refreshing = fetch(`${API_BASE}/api/auth/refresh`, {
    method: 'POST',
    credentials: 'include',
  })
    .then(async (res) => {
      if (!res.ok) return null
      const { access_token } = await res.json()
      setAccessToken(access_token)
      return access_token as string
    })
    .catch(() => null)
    .finally(() => {
      _refreshing = null
    })

  return _refreshing
}

async function request(
  path: string,
  init: RequestInit = {},
  isRetry = false,
): Promise<Response> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(init.headers as Record<string, string> | undefined),
  }
  if (_accessToken) headers['Authorization'] = `Bearer ${_accessToken}`

  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers,
    credentials: 'include',
  })

  if (res.status === 401 && !isRetry) {
    const newToken = await refreshAccessToken()
    if (newToken) return request(path, init, true)
    // Refresh failed — session is dead
    setAccessToken(null)
    _onAuthError?.()
    throw new AuthError()
  }

  return res
}

export const api = {
  get: (path: string) => request(path, { method: 'GET' }),

  post: (path: string, body: unknown) =>
    request(path, { method: 'POST', body: JSON.stringify(body) }),

  postText: (path: string, body: string) =>
    request(path, { method: 'POST', body, headers: { 'Content-Type': 'text/plain' } }),

  put: (path: string, body: unknown) =>
    request(path, { method: 'PUT', body: JSON.stringify(body) }),

  delete: (path: string) => request(path, { method: 'DELETE' }),
}
