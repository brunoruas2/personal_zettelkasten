'use client';

import { useState } from 'react';

/**
 * Corpo do modal de captura rápida: um campo, `Enter` grava, `Shift+Enter`
 * quebra a linha. A 1ª linha vira o título (ver `splitCapture`). O `Esc` e o
 * foco inicial são do `GalaxyModal`.
 */
export function QuickCapture({ onSubmit }: { onSubmit: (text: string) => void }) {
  const [text, setText] = useState('');
  const empty = text.trim() === '';

  const submit = () => {
    if (!empty) onSubmit(text);
  };

  return (
    <div className="flex flex-col gap-3 p-5">
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault();
            submit();
          }
        }}
        rows={5}
        placeholder="Escreva a ideia. A primeira linha vira o título."
        aria-label="Texto da captura"
        className="w-full resize-none rounded-xl border border-white/10 bg-[#05070c] p-3 text-[15px] leading-relaxed text-[#e6e9f0] outline-none placeholder:text-[#8b93a3] focus:border-white/25"
      />
      <div className="flex items-center justify-between gap-3 text-xs text-[#8b93a3]">
        <span>
          <kbd className="rounded border border-white/10 px-1.5">Enter</kbd> grava ·{' '}
          <kbd className="rounded border border-white/10 px-1.5">Shift Enter</kbd> quebra a linha · vai para a tag{' '}
          <span className="text-[#c9cfdb]">#inbox</span>
        </span>
        <button
          type="button"
          onClick={submit}
          disabled={empty}
          className="rounded-lg bg-brand px-3 py-1.5 text-sm font-medium text-white disabled:opacity-40"
        >
          Capturar
        </button>
      </div>
    </div>
  );
}
