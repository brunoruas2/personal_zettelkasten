'use client';

/** Botão de apagar zettel: ícone de borracha no lugar do texto, para caber na linha de ações. */
export function EraserButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      className="zk-btn-danger inline-flex items-center justify-center px-3"
      onClick={onClick}
      aria-label="Apagar zettel"
      title="Apagar zettel"
    >
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="square" strokeLinejoin="miter" className="h-5 w-5" aria-hidden="true">
        <path d="M20 20H9L3.5 14.5a2 2 0 0 1 0-2.8l8.2-8.2a2 2 0 0 1 2.8 0l6 6a2 2 0 0 1 0 2.8L13 20" />
        <path d="M7 10l7 7" />
      </svg>
    </button>
  );
}
