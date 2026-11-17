'use client';

import React, { useState } from 'react';
import { segmentChordPair } from '@zettelkasten/core';
import { hasInlineChords, inlineChords, isChord, isChordLine, transposeSource, tx } from '../lib/chordSyntax';

// ---------------------------------------------------------------------------
// Line renderers
// ---------------------------------------------------------------------------

function ChordLine({ line, semitones }: { line: string; semitones: number }) {
  const parts = line.replace(/^%c\s*/, '').split(/(\s+)/);
  return (
    <div data-chord className="whitespace-pre-wrap break-words font-semibold leading-5 text-brand">
      {parts.map((p, i) =>
        /^\s+$/.test(p) ? p : isChord(p) ? tx(p, semitones) : p
      )}
    </div>
  );
}

function InlineLine({ line, semitones }: { line: string; semitones: number }) {
  const nodes: React.ReactNode[] = [];
  let last = 0, k = 0;

  for (const m of inlineChords(line)) {
    if (m.index > last) nodes.push(<span key={k++}>{line.slice(last, m.index)}</span>);
    nodes.push(
      <span key={k++} data-chord className="whitespace-nowrap font-semibold text-brand">
        [{tx(m.chord, semitones)}]
      </span>
    );
    last = m.index + m.length;
  }
  if (last < line.length) nodes.push(<span key={k++}>{line.slice(last)}</span>);

  return (
    <div className="whitespace-pre-wrap break-words leading-relaxed text-zinc-800 dark:text-zinc-200">
      {nodes}
    </div>
  );
}

// Chord line over a lyric line: one inline block per segment (chord on top,
// lyric below), so wrapping happens between segments and every chord stays
// over its syllable. Segmentation runs on the original columns; only the
// chord text of each segment is transposed.
function ChordPair({ chordLine, lyricLine, semitones }: { chordLine: string; lyricLine: string; semitones: number }) {
  return (
    <div className="flex flex-wrap">
      {segmentChordPair(chordLine, lyricLine).map((seg, i) => {
        const chord = seg.chord ? tx(seg.chord, semitones) : '';
        return (
          <span
            key={i}
            className="inline-flex flex-col whitespace-pre"
            style={chord ? { minWidth: `${chord.length + 1}ch` } : undefined}
          >
            <span data-chord className="font-semibold leading-5 text-brand">{chord || '\u00A0'}</span>
            <span className="leading-relaxed text-zinc-800 dark:text-zinc-200">{seg.text || '\u00A0'}</span>
          </span>
        );
      })}
    </div>
  );
}

function renderLines(lines: string[], semitones: number): React.ReactNode[] {
  const out: React.ReactNode[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (hasInlineChords(line)) {
      out.push(<InlineLine key={i} line={line} semitones={semitones} />);
    } else if (isChordLine(line)) {
      const next = lines[i + 1];
      if (next !== undefined && next.trim() && !hasInlineChords(next) && !isChordLine(next)) {
        out.push(<ChordPair key={i} chordLine={line} lyricLine={next} semitones={semitones} />);
        i++;
      } else {
        out.push(<ChordLine key={i} line={line} semitones={semitones} />);
      }
    } else {
      out.push(
        <div key={i} className="whitespace-pre-wrap break-words leading-relaxed text-zinc-800 dark:text-zinc-200">
          {line || '\u00A0'}
        </div>,
      );
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function Chords({
  source,
  fontSize,
  onSave,
  onEditSource,
}: {
  source: string;
  fontSize?: number;
  onSave?: (newSource: string) => void;
  /** Editor do ZK//OS: botão "editar código-fonte" na barra (depois dos controles). */
  onEditSource?: () => void;
}) {
  const [semitones, setSemitones] = useState(0);

  const lines = source.split('\n');
  // Strip trailing blank lines
  while (lines.length && !lines[lines.length - 1].trim()) lines.pop();

  const label = semitones === 0 ? '0' : semitones > 0 ? `+${semitones}` : String(semitones);

  const handleSave = () => {
    onSave?.(transposeSource(source, semitones));
    setSemitones(0);
  };

  return (
    <div data-chords className="my-3 overflow-hidden rounded-lg border border-zinc-200 bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900">
      {/* Toolbar */}
      <div data-chords-bar className="flex items-center gap-1 border-b border-zinc-200 px-3 py-1.5 dark:border-zinc-700">
        <span className="flex-1 text-xs text-zinc-400">cifra</span>
        <button
          onClick={() => setSemitones((s) => s - 1)}
          className="flex h-6 w-6 items-center justify-center rounded text-base leading-none text-zinc-500 hover:bg-zinc-200 dark:hover:bg-zinc-700"
          aria-label="Diminuir tom"
        >
          −
        </button>
        <span className="w-8 text-center font-mono text-xs font-semibold text-brand">
          {label}
        </span>
        <button
          onClick={() => setSemitones((s) => s + 1)}
          className="flex h-6 w-6 items-center justify-center rounded text-base leading-none text-zinc-500 hover:bg-zinc-200 dark:hover:bg-zinc-700"
          aria-label="Aumentar tom"
        >
          +
        </button>
        {semitones !== 0 && (
          <button
            onClick={() => setSemitones(0)}
            className="ml-1 px-1 text-xs text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300"
          >
            reset
          </button>
        )}
        {semitones !== 0 && onSave && (
          <button
            onClick={handleSave}
            className="ml-1 px-1 text-xs font-medium text-brand hover:opacity-80"
          >
            Salvar
          </button>
        )}
        {onEditSource && (
          <button
            type="button"
            data-edit-source=""
            // mousedown não pode mover a seleção do ProseMirror antes do clique.
            onMouseDown={(e) => e.preventDefault()}
            onClick={onEditSource}
            aria-label="Editar código-fonte"
            title="Editar código-fonte"
            className="ml-2 flex h-6 w-6 items-center justify-center rounded text-base leading-none text-zinc-500 hover:bg-zinc-200 dark:hover:bg-zinc-700 [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover:opacity-100"
          >
            ✎
          </button>
        )}
      </div>

      {/* Sheet */}
      <div data-chords-sheet className="p-3 font-mono" style={{ fontSize: fontSize ?? undefined }}>
        {renderLines(lines, semitones)}
      </div>
    </div>
  );
}
