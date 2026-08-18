'use client';

import dynamic from 'next/dynamic';
import Link from 'next/link';

const GraphCanvas = dynamic(
  () => import('./GraphCanvas').then((m) => ({ default: m.GraphCanvas })),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-full items-center justify-center">
        <p className="text-sm text-zinc-400">Carregando mapa…</p>
      </div>
    ),
  },
);

export default function GraphPage() {
  return (
    <div className="fixed inset-0 overflow-hidden bg-zinc-950">
      {/* Header — pointer-events-none so Sigma canvas receives mouse/touch below */}
      <div className="pointer-events-none absolute left-0 right-0 top-0 z-10 flex items-center justify-between px-5 py-4">
        <Link href="/" className="pointer-events-auto text-sm font-medium text-brand-light hover:opacity-80">
          ← Voltar
        </Link>
        <span className="text-sm font-semibold text-zinc-300">Mapa de Conexões</span>
        <span className="hidden text-xs text-zinc-500 lg:block">Arraste · Scroll para zoom · Clique para navegar</span>
      </div>
      <GraphCanvas />
    </div>
  );
}
