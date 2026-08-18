'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '../../lib/api';
import { base64urlToBuffer, bufferToBase64url } from '../../lib/webauthn';

interface PasskeyRecord {
  id: string;
  name: string;
}

export default function PasskeysPage() {
  const router = useRouter();
  const [passkeys, setPasskeys] = useState<PasskeyRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [message, setMessage] = useState<{ text: string; ok: boolean } | null>(null);

  useEffect(() => {
    loadPasskeys();
  }, []);

  async function loadPasskeys() {
    setLoading(true);
    try {
      const res = await api.get('/api/auth/passkeys');
      if (res.ok) setPasskeys(await res.json());
    } finally {
      setLoading(false);
    }
  }

  async function handleAdd() {
    setAdding(true);
    setMessage(null);
    try {
      const beginRes = await api.post('/api/auth/passkey/register/begin', {});
      if (!beginRes.ok) throw new Error('Falha ao iniciar registro');
      const opts = await beginRes.json();
      const pk = opts.publicKey;

      const publicKey: PublicKeyCredentialCreationOptions = {
        ...pk,
        challenge: base64urlToBuffer(pk.challenge),
        user: { ...pk.user, id: base64urlToBuffer(pk.user.id) },
        excludeCredentials: pk.excludeCredentials?.map((c: { id: string; type: string }) => ({
          ...c,
          id: base64urlToBuffer(c.id),
        })) ?? [],
      };

      const credential = await navigator.credentials.create({ publicKey });
      if (!credential) throw new Error('Cancelado');

      const cred = credential as PublicKeyCredential;
      const resp = cred.response as AuthenticatorAttestationResponse;

      const finishRes = await api.post('/api/auth/passkey/register/finish', {
        id: cred.id,
        rawId: bufferToBase64url(cred.rawId),
        type: cred.type,
        response: {
          clientDataJSON: bufferToBase64url(resp.clientDataJSON),
          attestationObject: bufferToBase64url(resp.attestationObject),
        },
      });

      if (!finishRes.ok) throw new Error('Falha ao registrar passkey');
      setMessage({ text: 'Passkey adicionada!', ok: true });
      await loadPasskeys();
    } catch (e) {
      if (e instanceof Error && e.name !== 'NotAllowedError') {
        setMessage({ text: e.message, ok: false });
      }
    } finally {
      setAdding(false);
    }
  }

  async function handleDelete(id: string) {
    if (!confirm('Remover esta passkey?')) return;
    const res = await api.delete(`/api/auth/passkey/${id}`);
    if (res.ok) {
      setPasskeys((prev) => prev.filter((p) => p.id !== id));
      setMessage({ text: 'Passkey removida.', ok: true });
    } else {
      setMessage({ text: 'Erro ao remover.', ok: false });
    }
  }

  return (
    <div className="mx-auto max-w-sm px-4 py-8">
      {/* Header */}
      <div className="mb-8 flex items-center gap-3">
        <button
          onClick={() => router.back()}
          className="rounded-xl p-2 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600 dark:hover:bg-zinc-800 dark:hover:text-zinc-300 transition-colors"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M19 12H5"/><path d="M12 5l-7 7 7 7"/>
          </svg>
        </button>
        <h1 className="text-xl font-bold text-zinc-900 dark:text-zinc-100">Face ID / Touch ID</h1>
      </div>

      <p className="mb-6 text-sm text-zinc-500">
        Passkeys usam biometria do dispositivo para entrar sem senha.
      </p>

      {/* Feedback */}
      {message && (
        <p className={`mb-4 rounded-xl px-4 py-3 text-sm ${
          message.ok
            ? 'bg-green-50 text-green-700 dark:bg-green-950 dark:text-green-300'
            : 'bg-red-50 text-red-600 dark:bg-red-950 dark:text-red-400'
        }`}>
          {message.text}
        </p>
      )}

      {/* Lista */}
      {loading ? (
        <p className="text-sm text-zinc-400">Carregando...</p>
      ) : passkeys.length === 0 ? (
        <p className="mb-6 text-sm text-zinc-400">Nenhuma passkey cadastrada.</p>
      ) : (
        <ul className="mb-6 space-y-2">
          {passkeys.map((p) => (
            <li
              key={p.id}
              className="flex items-center justify-between rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-4 py-3"
            >
              <div className="flex items-center gap-3">
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-zinc-400">
                  <path d="M2 7V5a2 2 0 0 1 2-2h2"/><path d="M17 3h2a2 2 0 0 1 2 2v2"/><path d="M21 17v2a2 2 0 0 1-2 2h-2"/><path d="M7 21H5a2 2 0 0 1-2-2v-2"/><circle cx="9" cy="10" r="1"/><circle cx="15" cy="10" r="1"/><path d="M9.5 15a3.5 3.5 0 0 0 5 0"/>
                </svg>
                <span className="text-sm text-zinc-800 dark:text-zinc-200">{p.name}</span>
              </div>
              <button
                onClick={() => handleDelete(p.id)}
                className="rounded-lg p-1.5 text-zinc-300 hover:bg-red-50 hover:text-red-500 dark:hover:bg-red-950 transition-colors"
                title="Remover"
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/>
                </svg>
              </button>
            </li>
          ))}
        </ul>
      )}

      {/* Botão adicionar */}
      <button
        onClick={handleAdd}
        disabled={adding}
        className="w-full rounded-xl bg-brand py-3 text-sm font-bold text-white shadow-sm shadow-brand/30 transition-opacity hover:opacity-90 active:scale-95 disabled:opacity-50"
      >
        {adding ? 'Aguardando biometria...' : '+ Adicionar passkey'}
      </button>
    </div>
  );
}
