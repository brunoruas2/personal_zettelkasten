'use client';

import { forwardRef } from 'react';
import { MarkdownRenderer } from '../../components/MarkdownRenderer';

export const PANEL_WIDTH = 380;
export const PANEL_MAX_HEIGHT = 420;

interface ReadingPanelProps {
  title: string;
  body: string;
  /** Dentro do viewport atual do mapa — controla se o corpo é montado em markdown ou substituído por um placeholder leve. */
  visible: boolean;
  onOpen: () => void;
}

export const ReadingPanel = forwardRef<HTMLDivElement, ReadingPanelProps>(function ReadingPanel(
  { title, body, visible, onOpen },
  ref,
) {
  return (
    <div
      ref={ref}
      onClick={onOpen}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => { if (e.key === 'Enter') onOpen(); }}
      style={{
        position: 'absolute',
        left: 0,
        top: 0,
        width: PANEL_WIDTH,
        background: 'rgba(22,27,34,0.95)',
        border: '1px solid rgba(255,255,255,0.15)',
        borderRadius: 10,
        padding: '10px 14px',
        color: '#e6edf3',
        fontSize: '0.78rem',
        cursor: 'pointer',
        backdropFilter: 'blur(8px)',
        boxShadow: '0 8px 20px rgba(0,0,0,0.45)',
        willChange: 'transform',
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
          onClick={(e) => e.stopPropagation()}
          onWheel={(e) => e.stopPropagation()}
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
