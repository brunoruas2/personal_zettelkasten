'use client';

import { useEffect, useRef } from 'react';
import type { Zettel } from '@zettelkasten/core';
import { InplaceEditor, type InplaceEditorHandle, type SaveStatus } from './InplaceEditor';

const STATUS_LABEL: Record<SaveStatus, string> = {
  idle: '',
  saving: 'Salvando…',
  saved: 'Salvo',
  offline: 'Não salvo — offline',
  error: 'Erro ao salvar',
};

/**
 * Editor em tela cheia sobre a galáxia: o do celular e, em qualquer
 * dispositivo, o de um zettel sem lugar na galáxia (não há card para editar).
 * A galáxia continua montada atrás, intacta. O voltar do sistema fecha o editor: uma entrada de histórico
 * é empilhada ao abrir e o `popstate` a consome.
 */
export function FullscreenEditor({
  zettel,
  variant,
  status,
  autoFocusTitle,
  onStatus,
  onCreateLink,
  onNavigateLink,
  onClose,
}: {
  zettel: Zettel;
  variant: 'card' | 'mobile';
  status: SaveStatus;
  autoFocusTitle: boolean;
  onStatus: (s: SaveStatus) => void;
  onCreateLink: (title: string) => void | Promise<void>;
  /** Chip do rodapé de links: fecha o editor (gravando) e depois navega. */
  onNavigateLink?: (id: string) => void;
  onClose: () => void;
}) {
  const editorRef = useRef<InplaceEditorHandle>(null);
  const closingRef = useRef(false);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const afterCloseRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    window.history.pushState({ galaxyEditor: zettel.id }, '', window.location.href);
    const onPop = () => {
      if (closingRef.current) return;
      closingRef.current = true;
      void editorRef.current?.flush().finally(() => {
        onCloseRef.current();
        afterCloseRef.current?.();
      });
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, [zettel.id]);

  // Fechar pelo botão consome a entrada de histórico empilhada; o popstate
  // resultante faz o flush e fecha.
  const back = () => {
    window.history.back();
  };

  return (
    <div className="fixed inset-0 z-50 flex h-[100dvh] flex-col bg-[#05070c] font-geist text-[#e6e9f0]">
      <div className="flex shrink-0 items-center justify-between border-b border-white/10 px-4 py-3">
        <button type="button" onClick={back} className="text-sm text-[#c9cfdb]">
          ← Galáxia
        </button>
        <span className="text-xs text-[#8b93a3]">{STATUS_LABEL[status]}</span>
      </div>
      <div className={`min-h-0 flex-1 ${variant === 'card' ? 'mx-auto w-full max-w-3xl' : ''}`}>
        <InplaceEditor
          ref={editorRef}
          zettel={zettel}
          variant={variant}
          autoFocusTitle={autoFocusTitle}
          onStatus={onStatus}
          onCreateLink={onCreateLink}
          onNavigateLink={
            onNavigateLink
              ? (id) => {
                  // A navegação só roda depois do popstate que fecha o editor.
                  afterCloseRef.current = () => onNavigateLink(id);
                  back();
                }
              : undefined
          }
        />
      </div>
    </div>
  );
}
