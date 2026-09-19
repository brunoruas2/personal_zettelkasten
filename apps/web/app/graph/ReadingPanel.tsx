'use client';

import { memo } from 'react';
import { MarkdownRenderer } from '../../components/MarkdownRenderer';

export const PANEL_WIDTH = 380;
export const PANEL_MAX_HEIGHT = 420;

interface ReadingPanelProps {
  id: string;
  title: string;
  body: string;
  /** Dentro do viewport atual do mapa — controla se o corpo é montado em markdown ou substituído por um placeholder leve. */
  visible: boolean;
  /** Estável entre renders (recebe o id), para o `memo` valer. */
  onOpen: (id: string) => void;
  /** Registra/remove o elemento DOM — o mapa escreve o transform imperativamente. */
  registerEl: (id: string, el: HTMLDivElement | null) => void;
}

export const ReadingPanel = memo(function ReadingPanel({ id, title, body, visible, onOpen, registerEl }: ReadingPanelProps) {
  return (
    <div
      ref={(el) => registerEl(id, el)}
      onClick={() => onOpen(id)}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => { if (e.key === 'Enter') onOpen(id); }}
      style={{
        position: 'absolute',
        left: 0,
        top: 0,
        width: PANEL_WIDTH,
        // Opaco e sem backdrop-filter: o blur por painel custava composição
        // proporcional ao número de painéis sobrepostos.
        background: 'rgb(22,27,34)',
        border: '1px solid rgba(255,255,255,0.15)',
        borderRadius: 10,
        padding: '10px 14px',
        color: '#e6edf3',
        fontSize: '0.78rem',
        cursor: 'pointer',
        boxShadow: '0 8px 20px rgba(0,0,0,0.45)',
        contain: 'layout paint style',
        // O mapa escreve `translate(P) scale(s) translate(-50%,-50%)`; isso só
        // centra o painel em P para qualquer zoom com a origem no canto.
        // Com o padrão (50% 50%) o centro deriva em (1−s)·(w/2, h/2).
        transformOrigin: '0 0',
      }}
    >
      <strong
        style={{
          display: 'block',
          marginBottom: 4,
          fontSize: '0.85rem',
          color: title ? '#e6edf3' : '#7d8590',
          fontStyle: title ? 'normal' : 'italic',
        }}
      >
        {title || 'Sem título — clique para nomear'}
      </strong>
      {visible ? (
        <div
          data-panel-scroll
          onClick={(e) => e.stopPropagation()}
          style={{ maxHeight: PANEL_MAX_HEIGHT - 40, overflowY: 'auto', lineHeight: 1.4, cursor: 'auto' }}
        >
          {body.trim() ? (
            <MarkdownRenderer body={body} disableWikiLinks onLinkPress={() => {}} />
          ) : (
            <p style={{ color: '#7d8590', fontStyle: 'italic', margin: 0 }}>Sem conteúdo ainda.</p>
          )}
        </div>
      ) : (
        <div style={{ color: '#7d8590', fontSize: '0.72rem' }}>…</div>
      )}
    </div>
  );
});
