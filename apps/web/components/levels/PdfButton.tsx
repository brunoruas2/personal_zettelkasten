'use client';

/** Botão de exportar PDF: ícone de documento, ao lado da borracha na linha de ações. */
export function PdfButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      className="zk-btn inline-flex items-center justify-center px-3"
      onClick={onClick}
      aria-label="Exportar PDF"
      title="Exportar PDF"
    >
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="square" strokeLinejoin="miter" className="h-5 w-5" aria-hidden="true">
        <path d="M14 3H6v18h12V7z" />
        <path d="M14 3v4h4" />
        <path d="M9 13h6M9 17h6" />
      </svg>
    </button>
  );
}
