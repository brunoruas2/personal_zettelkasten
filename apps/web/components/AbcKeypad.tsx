'use client';

import { useEffect, useState } from 'react';
import { type Editor } from '@tiptap/react';
import {
  ABC_DURATIONS,
  DEFAULT_OCTAVE,
  MAX_OCTAVE,
  MIN_OCTAVE,
  PIANO_KEYS,
  clampOctave,
  noteToAbc,
  noteToMidi,
} from '@zettelkasten/core';
import { playNote, preloadAbcjs, unlockAudio, warmUp } from '../lib/abcAudio';

/**
 * Altura sem a safe area: três linhas de 44 px (controles, edição, fechar), o
 * piano de 112 px, 3 gaps de 6 px, 6 px de padding no topo e 20 embaixo. A safe
 * area é somada por fora (ver `height` abaixo), como no `ChordKeypad`.
 */
export const ABC_KEYPAD_HEIGHT = 288;

interface Props {
  editor: Editor | null;
  active: boolean;
  onRequestClose: () => void;
  /** Altura ocupada pelo teclado nativo, medida pela página. */
  keyboardOffset: number;
  /** Força uma remedição do viewport fora dos eventos de `visualViewport`. */
  onRecomputeOffset: () => void;
}

type Mode = 'play' | 'insert';

// Teclas brancas (semitons) e, entre quais brancas, cada preta (índice da branca à esquerda).
const WHITE = PIANO_KEYS.filter((k) => !k.black);
const BLACK_AFTER_WHITE: Record<number, number> = { 1: 0, 3: 1, 6: 3, 8: 4, 10: 5 };

export function AbcKeypad({ editor, active, onRequestClose, keyboardOffset, onRecomputeOffset }: Props) {
  // Oitava, modo e duração são locais ao teclado: nada disso persiste.
  const [octave, setOctave] = useState(DEFAULT_OCTAVE);
  const [mode, setMode] = useState<Mode>('insert');
  const [durationIdx, setDurationIdx] = useState(() => ABC_DURATIONS.findIndex((d) => d.suffix === ''));

  // Mesma razão do `ChordKeypad`: remedir o viewport no mount cobre o iOS, que
  // nem sempre emite `resize` quando o teclado nativo fecha sem gesto.
  useEffect(() => {
    onRecomputeOffset();
  }, [onRecomputeOffset]);

  // Carrega o abcjs e o soundfont da oitava central antes da primeira tecla.
  useEffect(() => {
    void preloadAbcjs().then(() => warmUp());
  }, []);

  useEffect(() => {
    if (!editor || !active) return;
    const dom = editor.view.dom as HTMLElement;
    const prev = dom.getAttribute('inputmode');
    dom.setAttribute('inputmode', 'none');
    const wasFocused = document.activeElement === dom;
    if (wasFocused) {
      dom.blur();
      requestAnimationFrame(() => {
        dom.focus();
        onRecomputeOffset();
      });
    }
    return () => {
      if (prev) dom.setAttribute('inputmode', prev);
      else dom.removeAttribute('inputmode');
    };
  }, [editor, active, onRecomputeOffset]);

  function insertText(text: string) {
    // Nó de texto direto: o parser HTML do insertContent(string) descarta texto
    // só-de-espaço/quebra de linha (ver `ChordKeypad`).
    editor?.chain().focus().insertContent({ type: 'text', text }).run();
  }

  function handleBackspace() {
    editor?.chain().focus().command(({ tr, state }) => {
      const { from, to } = state.selection;
      if (from !== to) {
        tr.delete(from, to);
        return true;
      }
      if (from <= 1) return false;
      tr.delete(from - 1, from);
      return true;
    }).run();
  }

  function handleClose() {
    const dom = editor?.view.dom as HTMLElement | undefined;
    dom?.removeAttribute('inputmode');
    onRequestClose();
    if (dom) {
      dom.blur();
      requestAnimationFrame(() => {
        dom.focus();
        onRecomputeOffset();
      });
    }
  }

  function pressNote(semitone: number) {
    // Na pilha síncrona do toque: é o que libera o áudio no iOS.
    unlockAudio();
    void playNote(noteToMidi(semitone, octave));
    if (mode === 'insert') insertText(noteToAbc(semitone, octave, ABC_DURATIONS[durationIdx].suffix));
  }

  // Ação no `pointerdown` (o som sai sem esperar o `click`) e `preventDefault`
  // para o editor não perder foco nem seleção.
  function press(action: () => void) {
    return {
      onPointerDown: (e: React.PointerEvent) => {
        e.preventDefault();
        action();
      },
      onMouseDown: (e: React.MouseEvent) => e.preventDefault(),
    };
  }

  const base = 'flex h-11 shrink-0 items-center justify-center rounded-xl text-sm font-bold transition-colors px-2';
  const keyClass = `${base} bg-zinc-100 text-zinc-700 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-200 dark:hover:bg-zinc-700`;
  const onClass = `${base} bg-brand text-white`;
  const disabledClass = 'disabled:opacity-40';

  return (
    <div
      className="fixed left-0 lg:left-80 right-0 z-10 flex flex-col gap-1.5 border-t border-zinc-200 bg-white px-2 pt-1.5 dark:border-zinc-800 dark:bg-zinc-950 lg:hidden"
      style={{
        bottom: keyboardOffset,
        height: `calc(${ABC_KEYPAD_HEIGHT}px + env(safe-area-inset-bottom, 0px))`,
        paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 20px)',
      }}
    >
      <div className="flex items-center gap-1">
        <button
          {...press(() => setOctave((o) => clampOctave(o - 1)))}
          disabled={octave <= MIN_OCTAVE}
          aria-label="Oitava abaixo"
          className={`${keyClass} ${disabledClass} w-10`}
        >
          −
        </button>
        <span className="w-9 text-center text-sm font-bold tabular-nums text-zinc-700 dark:text-zinc-200" aria-label={`Oitava ${octave}`}>
          C{octave}
        </span>
        <button
          {...press(() => setOctave((o) => clampOctave(o + 1)))}
          disabled={octave >= MAX_OCTAVE}
          aria-label="Oitava acima"
          className={`${keyClass} ${disabledClass} w-10`}
        >
          +
        </button>
        <div className="ml-1 flex flex-1 gap-1" role="group" aria-label="Modo">
          <button {...press(() => setMode('play'))} aria-pressed={mode === 'play'} className={`${mode === 'play' ? onClass : keyClass} flex-1`}>
            Tocar
          </button>
          <button {...press(() => setMode('insert'))} aria-pressed={mode === 'insert'} className={`${mode === 'insert' ? onClass : keyClass} flex-1`}>
            Inserir
          </button>
        </div>
        <button
          {...press(() => setDurationIdx((i) => (i + 1) % ABC_DURATIONS.length))}
          aria-label="Duração da nota"
          className={`${keyClass} w-12`}
        >
          ♩{ABC_DURATIONS[durationIdx].label}
        </button>
      </div>

      <div className="relative flex gap-px" style={{ height: 112 }}>
        {WHITE.map((k) => (
          <button
            key={k.semitone}
            {...press(() => pressNote(k.semitone))}
            aria-label={k.label}
            className="flex flex-1 items-end justify-center rounded-b-lg border border-zinc-300 bg-white pb-1 text-xs font-bold text-zinc-500 active:bg-brand/30 dark:border-zinc-600 dark:bg-zinc-200 dark:text-zinc-600"
          >
            {k.label}
          </button>
        ))}
        {PIANO_KEYS.filter((k) => k.black).map((k) => (
          <button
            key={k.semitone}
            {...press(() => pressNote(k.semitone))}
            aria-label={k.label}
            className="absolute top-0 z-10 flex items-end justify-center rounded-b-md bg-zinc-900 pb-1 text-[10px] font-bold text-zinc-300 active:bg-brand dark:bg-zinc-700 dark:text-zinc-100"
            style={{
              left: `${((BLACK_AFTER_WHITE[k.semitone] + 1) / WHITE.length) * 100}%`,
              width: '8.5%',
              height: '62%',
              transform: 'translateX(-50%)',
            }}
          >
            {k.label}
          </button>
        ))}
      </div>

      <div className="flex items-center gap-1">
        <button {...press(() => insertText('|'))} className={`${keyClass} flex-1`}>|</button>
        <button {...press(() => insertText('z'))} aria-label="Pausa" className={`${keyClass} flex-1`}>z</button>
        <button {...press(() => insertText(' '))} className={`${keyClass} flex-[2]`}>espaço</button>
        <button {...press(() => insertText('\n'))} aria-label="Nova linha" className={`${keyClass} flex-1`}>↵</button>
        <button {...press(handleBackspace)} aria-label="Apagar" className={`${keyClass} flex-1`}>⌫</button>
      </div>

      <div className="flex items-center">
        {/* `onClick`, não `pointerdown`: o teclado some ao fechar e o clique não pode cair no que ficou embaixo. */}
        <button
          onMouseDown={(e) => e.preventDefault()}
          onClick={handleClose}
          className="flex h-11 flex-1 shrink-0 items-center justify-center rounded-xl bg-brand text-sm font-bold text-white"
        >
          Teclado normal
        </button>
      </div>
    </div>
  );
}
