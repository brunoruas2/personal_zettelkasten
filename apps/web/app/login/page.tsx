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
      <div className="flex h-screen items-center justify-center bg-zinc-50 dark:bg-zinc-950">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-brand border-t-transparent" />
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-zinc-50 dark:bg-zinc-950 px-4">
      <div className="w-full max-w-sm space-y-4 rounded-2xl bg-white p-8 shadow-sm dark:bg-zinc-900">
        {/* Logo */}
        <div className="mb-6 text-center">
          <div className="mb-2 text-3xl text-brand">✦</div>
          <h1 className="text-xl font-bold text-zinc-900 dark:text-zinc-100">Zettelkasten</h1>
          <p className="mt-1 text-sm text-zinc-500">Sua base de conhecimento</p>
        </div>

        {error && (
          <p className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-600 dark:bg-red-950 dark:text-red-400">
            {error}
          </p>
        )}

        {/* Passkey login — mostrado antes do form se suportado */}
        {isPasskeySupported() && (
          <button
            type="button"
            onClick={handlePasskeyLogin}
            disabled={isPasskeyPending || isPending}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-zinc-900 py-3 text-sm font-bold text-white shadow-sm transition-opacity hover:opacity-90 active:scale-95 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900"
          >
            {isPasskeyPending ? (
              <span className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent dark:border-zinc-900 dark:border-t-transparent" />
            ) : (
              <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M2 7V5a2 2 0 0 1 2-2h2"/><path d="M17 3h2a2 2 0 0 1 2 2v2"/><path d="M21 17v2a2 2 0 0 1-2 2h-2"/><path d="M7 21H5a2 2 0 0 1-2-2v-2"/><circle cx="9" cy="10" r="1"/><circle cx="15" cy="10" r="1"/><path d="M9.5 15a3.5 3.5 0 0 0 5 0"/>
              </svg>
            )}
            {isPasskeyPending ? 'Aguardando...' : 'Entrar com Face ID / Touch ID'}
          </button>
        )}

        {/* Divisor */}
        {isPasskeySupported() && (
          <div className="flex items-center gap-3">
            <div className="h-px flex-1 bg-zinc-200 dark:bg-zinc-700" />
            <span className="text-xs text-zinc-400">ou</span>
            <div className="h-px flex-1 bg-zinc-200 dark:bg-zinc-700" />
          </div>
        )}

        {/* Formulário usuário + senha */}
        <form onSubmit={handleSubmit} className="space-y-3">
          <input
            type="text"
            placeholder="Usuário"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            className="w-full rounded-xl border border-zinc-200 bg-white px-4 py-3 text-sm text-zinc-900 outline-none transition-colors focus:border-brand dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
            required
            autoComplete="username"
            autoCapitalize="none"
          />

          <input
            type="password"
            placeholder="Senha"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full rounded-xl border border-zinc-200 bg-white px-4 py-3 text-sm text-zinc-900 outline-none transition-colors focus:border-brand dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
            required
            autoComplete="current-password"
          />

          <button
            type="submit"
            disabled={isPending || isPasskeyPending}
            className="w-full rounded-xl bg-brand py-3 text-sm font-bold text-white shadow-sm shadow-brand/30 transition-opacity hover:opacity-90 active:scale-95 disabled:opacity-50"
          >
            {isPending ? 'Entrando...' : 'Entrar'}
          </button>
        </form>
      </div>
    </div>
  );
}
