'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '../../providers/AuthProvider';
import { isPasskeySupported } from '../../lib/webauthn';

export default function LoginPage() {
  const { login, loginWithPasskey, isAuthenticated, isLoading } = useAuth();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [isPending, setIsPending] = useState(false);
  const [isPasskeyPending, setIsPasskeyPending] = useState(false);
  const router = useRouter();

  useEffect(() => {
    if (!isLoading && isAuthenticated) {
      router.replace('/');
    }
  }, [isAuthenticated, isLoading, router]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setIsPending(true);
    try {
      await login(username, password);
      router.replace('/');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao entrar');
    } finally {
      setIsPending(false);
    }
  }

  async function handlePasskeyLogin() {
    setError('');
    setIsPasskeyPending(true);
    try {
      await loginWithPasskey();
      router.replace('/');
    } catch (err) {
      if (err instanceof Error && err.name !== 'NotAllowedError') {
        setError(err.message);
      }
    } finally {
      setIsPasskeyPending(false);
    }
  }

  if (isLoading) {
    return (
      <div className="zk-root zk-desk flex h-screen items-center justify-center">
        <span className="zk-caret" />
      </div>
    );
  }

  const busy = isPending || isPasskeyPending;

  return (
    <div className="zk-root zk-desk relative flex min-h-screen items-center justify-center px-4">
      <div className="zk-win w-full max-w-sm">
        <div className="zk-titlebar">
          <span>ZK//OS — ENTRAR</span>
        </div>

        <div className="space-y-4 p-6">
          <div className="text-center">
            <h1 className="zk-display text-4xl" style={{ color: 'var(--zk-cyan)' }}>
              Zettelkasten
            </h1>
            <p className="text-lg" style={{ color: 'var(--zk-dim)' }}>
              Sua base de conhecimento
            </p>
          </div>

          {error && (
            <p
              role="alert"
              className="border px-3 py-2 text-lg"
              style={{ borderColor: 'var(--zk-magenta)', color: 'var(--zk-magenta)' }}
            >
              {error}
            </p>
          )}

          {/* Passkey login — mostrado antes do form se suportado */}
          {isPasskeySupported() && (
            <button
              type="button"
              onClick={handlePasskeyLogin}
              disabled={busy}
              className="zk-btn flex w-full items-center justify-center gap-2"
            >
              {isPasskeyPending ? (
                'Aguardando...'
              ) : (
                <>
                  <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M2 7V5a2 2 0 0 1 2-2h2"/><path d="M17 3h2a2 2 0 0 1 2 2v2"/><path d="M21 17v2a2 2 0 0 1-2 2h-2"/><path d="M7 21H5a2 2 0 0 1-2-2v-2"/><circle cx="9" cy="10" r="1"/><circle cx="15" cy="10" r="1"/><path d="M9.5 15a3.5 3.5 0 0 0 5 0"/>
                  </svg>
                  Entrar com Face ID / Touch ID
                </>
              )}
            </button>
          )}

          {/* Divisor */}
          {isPasskeySupported() && (
            <div className="flex items-center gap-3">
              <div className="h-px flex-1" style={{ background: 'var(--zk-line)' }} />
              <span className="text-lg" style={{ color: 'var(--zk-dim)' }}>ou</span>
              <div className="h-px flex-1" style={{ background: 'var(--zk-line)' }} />
            </div>
          )}

          {/* Formulário usuário + senha */}
          <form onSubmit={handleSubmit} className="space-y-3">
            <input
              type="text"
              placeholder="Usuário"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className="zk-field w-full px-4 py-2 text-xl"
              required
              autoComplete="username"
              autoCapitalize="none"
            />

            <input
              type="password"
              placeholder="Senha"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="zk-field w-full px-4 py-2 text-xl"
              required
              autoComplete="current-password"
            />

            <button type="submit" disabled={busy} className="zk-btn-hot w-full disabled:opacity-50">
              {isPending ? 'Entrando...' : 'Entrar'}
            </button>
          </form>
        </div>
      </div>
      <div aria-hidden="true" className="zk-vignette absolute inset-0" />
    </div>
  );
}
