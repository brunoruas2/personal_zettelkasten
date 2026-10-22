'use client';

import { useEffect, useRef } from 'react';

/**
 * "Página" da galáxia: modal escuro sobre o canvas, que continua visível atrás.
 * O `.dark` na caixa força o tema escuro nos painéis extraídos (o Tailwind
 * aceita escuro por sistema ou por ancestral `.dark`). `Esc` vai na fase de
 * captura para fechar este modal antes de qualquer overlay de dentro.
 */
export function GalaxyModal({
  title,
  onClose,
  children,
  wide = false,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  wide?: boolean;
}) {
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      e.stopPropagation();
      onClose();
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [onClose]);

  useEffect(() => {
    const first = boxRef.current?.querySelector<HTMLElement>('input, textarea, select, button:not([data-modal-close])');
    first?.focus({ preventScroll: true });
  }, []);

  return (
    <div
      className="fixed inset-0 z-40 flex items-stretch justify-center bg-[#05070c]/70 font-geist lg:items-start lg:p-6 lg:pt-[6vh]"
      onClick={onClose}
    >
      <div
        ref={boxRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
        className={`dark flex w-full flex-col overflow-hidden border-white/10 bg-[#0e121a] text-[#e6e9f0] shadow-2xl lg:max-h-[85vh] lg:rounded-2xl lg:border ${
          wide ? 'lg:max-w-6xl xl:max-w-7xl' : 'lg:max-w-3xl'
        }`}
      >
        <div className="flex shrink-0 items-center justify-between border-b border-white/10 px-5 py-3">
          <h2 className="font-newsreader text-lg font-medium">{title}</h2>
          <button
            type="button"
            data-modal-close
            onClick={onClose}
            title="Fechar (Esc)"
            className="rounded-lg px-2 py-1 text-sm text-[#8b93a3] hover:bg-white/5 hover:text-[#e6e9f0]"
          >
            Esc
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">{children}</div>
      </div>
    </div>
  );
}
