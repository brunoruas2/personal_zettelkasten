'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react';
import { useRouter } from 'next/navigation';
import {
  api,
  API_BASE,
  setAccessToken,
  registerAuthErrorHandler,
} from '../lib/api';
import { base64urlToBuffer, bufferToBase64url } from '../lib/webauthn';
import { useZettelStore } from '../store/useZettelStore';

interface User {
  id: string;
  username: string;
  role: string;
}

interface AuthContextValue {
  user: User | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  login: (username: string, password: string) => Promise<void>;
  loginWithPasskey: () => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

// User is stored in localStorage so the app can recognise the session
// when offline (access token lives only in memory, but we don't need it
// to render — all data comes from IndexedDB). On the next online session
// the token is transparently refreshed via the HttpOnly cookie.
const USER_CACHE_KEY = 'zettelkasten_offline_user';

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const router = useRouter();
  // Stable ref to avoid re-registering the handler on every render
  const routerRef = useRef(router);
  useEffect(() => { routerRef.current = router; }, [router]);

  const handleAuthError = useCallback(() => {
    setUser(null);
    setAccessToken(null);
    localStorage.removeItem('zettelkasten_offline_user');
    // Use hard navigation so the SW always serves a cached shell,
    // even if /login was never visited or the Next.js router is offline.
    window.location.href = '/login';
  }, []);

  useEffect(() => {
    registerAuthErrorHandler(handleAuthError);
  }, [handleAuthError]);

  useEffect(() => {
    restoreSession();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function restoreSession() {
    try {
      const refreshRes = await fetch(`${API_BASE}/api/auth/refresh`, {
        method: 'POST',
        credentials: 'include',
      });
      if (!refreshRes.ok) {
        // Server reachable but refresh failed (e.g. cookie expired, or server DB was
        // reset and the user account no longer exists). Clear ALL session + sync state
        // so the next login triggers a fresh migration from IndexedDB to the new account.
        localStorage.removeItem(USER_CACHE_KEY);
        localStorage.removeItem('zettel_last_sync_at');
        localStorage.removeItem('zettel_sync_queue');
        return;
      }

      const { access_token } = await refreshRes.json();
      setAccessToken(access_token);

      const meRes = await api.get('/api/auth/me');
      if (meRes.ok) {
        const userData = await meRes.json();
        setUser(userData);
        localStorage.setItem(USER_CACHE_KEY, JSON.stringify(userData));
      }
    } catch {
      // Network error (offline or server unreachable).
      // Restore the cached user so the app can load IndexedDB data
      // and the sync queue can drain once the device comes back online.
      const cached = localStorage.getItem(USER_CACHE_KEY);
      if (cached) {
        try {
          setUser(JSON.parse(cached));
        } catch {
          localStorage.removeItem(USER_CACHE_KEY);
        }
      }
    } finally {
      setIsLoading(false);
    }
  }

  async function login(username: string, password: string): Promise<void> {
    const res = await fetch(`${API_BASE}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
      credentials: 'include',
    });

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error((body as { error?: string }).error ?? 'Credenciais inválidas');
    }

    const { access_token } = await res.json();
    setAccessToken(access_token);

    const meRes = await api.get('/api/auth/me');
    if (!meRes.ok) throw new Error('Erro ao carregar usuário');
    const userData = await meRes.json();
    setUser(userData);
    localStorage.setItem(USER_CACHE_KEY, JSON.stringify(userData));
  }

  async function loginWithPasskey(): Promise<void> {
    const beginRes = await fetch(`${API_BASE}/api/auth/passkey/login/begin`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
      credentials: 'include',
    });
    if (!beginRes.ok) throw new Error('Falha ao iniciar autenticação');

    const opts = await beginRes.json();
    const pk = opts.publicKey;

    const publicKey: PublicKeyCredentialRequestOptions = {
      ...pk,
      challenge: base64urlToBuffer(pk.challenge),
      allowCredentials: pk.allowCredentials?.map((c: { id: string; type: string }) => ({
        ...c,
        id: base64urlToBuffer(c.id),
      })) ?? [],
    };

    const assertion = await navigator.credentials.get({ publicKey });
    if (!assertion) throw new Error('Cancelado');

    const cred = assertion as PublicKeyCredential;
    const resp = cred.response as AuthenticatorAssertionResponse;

    const finishRes = await fetch(`${API_BASE}/api/auth/passkey/login/finish`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: cred.id,
        rawId: bufferToBase64url(cred.rawId),
        type: cred.type,
        response: {
          clientDataJSON: bufferToBase64url(resp.clientDataJSON),
          authenticatorData: bufferToBase64url(resp.authenticatorData),
          signature: bufferToBase64url(resp.signature),
          userHandle: resp.userHandle ? bufferToBase64url(resp.userHandle) : null,
        },
      }),
      credentials: 'include',
    });

    if (!finishRes.ok) {
      const body = await finishRes.json().catch(() => ({}));
      throw new Error((body as { error?: string }).error ?? 'Falha na autenticação biométrica');
    }

    const { access_token } = await finishRes.json();
    setAccessToken(access_token);

    const meRes = await api.get('/api/auth/me');
    if (!meRes.ok) throw new Error('Erro ao carregar usuário');
    const userData = await meRes.json();
    setUser(userData);
    localStorage.setItem(USER_CACHE_KEY, JSON.stringify(userData));
  }

  async function logout(): Promise<void> {
    try {
      await api.post('/api/auth/logout', {});
    } catch {
      // ignore network errors on logout
    }
    await useZettelStore.getState().clearAll();
    localStorage.removeItem('zettel_sync_queue');
    localStorage.removeItem('zettel_last_sync_at');
    localStorage.removeItem(USER_CACHE_KEY);
    setAccessToken(null);
    setUser(null);
    window.location.href = '/login';
  }

  return (
    <AuthContext.Provider
      value={{
        user,
        isAuthenticated: !!user,
        isLoading,
        login,
        loginWithPasskey,
        logout,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
