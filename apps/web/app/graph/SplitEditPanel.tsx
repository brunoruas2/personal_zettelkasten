'use client';

import { useEffect, useRef } from 'react';
import { ZettelEditForm } from '../../components/ZettelEditForm';

interface SplitEditPanelProps {
  zettelId: string;
  onClose: () => void;
}

/**
 * Ancorado à direita do mapa em telas `lg:` (mapa encolhe, mas continua
 * montado/interativo ao lado); abaixo de `lg:` vira um overlay de tela cheia
 * com backdrop, já que não há espaço para dividir horizontalmente.
 */
export function SplitEditPanel({ zettelId, onClose }: SplitEditPanelProps) {
  const dirtyRef = useRef(false);

  const requestClose = () => {
    if (dirtyRef.current && !window.confirm('Descartar alterações não salvas?')) return;
    onClose();
  };

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      requestClose();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <>
      {/* Backdrop só no layout mobile (tela cheia) — no desktop o mapa deve
          continuar clicável/interativo ao lado do painel. */}
      <div
        className="lg:hidden fixed inset-0 z-40 bg-black/60"
        onClick={requestClose}
      />
      <div className="fixed inset-0 z-50 lg:static lg:z-auto lg:w-[560px] lg:flex-shrink-0 lg:border-l lg:border-zinc-800 bg-white dark:bg-zinc-950 overflow-hidden">
        <ZettelEditForm
          zettelId={zettelId}
          layout="panel"
          onCancel={onClose}
          onDirtyChange={(dirty) => { dirtyRef.current = dirty; }}
        />
      </div>
    </>
  );
}
