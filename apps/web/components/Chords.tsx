'use client';

import React, { useState } from 'react';
import { Chord, Interval } from 'tonal';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isChord(s: string): boolean {
  return s.length > 0 && !Chord.get(s).empty;
}

// A line is a "chord line" when ≥60% of its space-separated tokens are valid
// chord names. The optional %c marker forces chord interpretation.
function isChordLine(line: string): boolean {
  const tokens = line.replace(/^%c\s*/, '').trim().split(/\s+/).filter(Boolean);
  if (!tokens.length) return false;
  const n = tokens.filter(isChord).length;
  return n > 0 && n / tokens.length >= 0.6;
}

// Inline chord format: [Am]letra [G]aqui
function hasInlineChords(line: string): boolean {
  return /\[[A-G][#b]?[^\]\n]*\]/.test(line);
}

function tx(chord: string, semitones: number): string {
  if (!semitones) return chord;
  return Chord.transpose(chord, Interval.fromSemitones(semitones)) || chord;
}

function transposeChordLine(line: string, semitones: number): string {
  const prefixMatch = line.match(/^%c\s*/);
  const prefix = prefixMatch ? prefixMatch[0] : '';
  const rest = prefix ? line.slice(prefix.length) : line;
  const parts = rest.split(/(\s+)/).map((p) => (/^\s+$/.test(p) ? p : isChord(p) ? tx(p, semitones) : p));
  return prefix + parts.join('');
}

function transposeInlineLine(line: string, semitones: number): string {
  return line.replace(/\[([A-G][#b]?[^\]]*)\]/g, (_, chord) => `[${tx(chord, semitones)}]`);
}

// Rebuilds the raw block source with each chord symbol transposed, leaving
// lyrics/spacing/blank lines untouched — used to persist a transposition
// into the zettel body instead of keeping it as ephemeral render state.
function transposeSource(source: string, semitones: number): string {
  if (!semitones) return source;
  return source
    .split('\n')
    .map((line) => {
      if (hasInlineChords(line)) return transposeInlineLine(line, semitones);
      if (isChordLine(line)) return transposeChordLine(line, semitones);
      return line;
    })
    .join('\n');
}

// ---------------------------------------------------------------------------
// Line renderers
// ---------------------------------------------------------------------------

function ChordLine({ line, semitones }: { line: string; semitones: number }) {
  const parts = line.replace(/^%c\s*/, '').split(/(\s+)/);
  return (
    <div className="whitespace-pre font-semibold leading-5 text-brand">
      {parts.map((p, i) =>
        /^\s+$/.test(p) ? p : isChord(p) ? tx(p, semitones) : p
      )}
    </div>
  );
}

function InlineLine({ line, semitones }: { line: string; semitones: number }) {
  const nodes: React.ReactNode[] = [];
  const re = /\[([A-G][#b]?[^\]]*)\]/g;
  let last = 0, k = 0;
  let m: RegExpExecArray | null;

  while ((m = re.exec(line)) !== null) {
    if (m.index > last) nodes.push(<span key={k++}>{line.slice(last, m.index)}</span>);
    nodes.push(
      <span key={k++} className="font-semibold text-brand">
        [{tx(m[1], semitones)}]
      </span>
    );
    last = m.index + m[0].length;
  }
  if (last < line.length) nodes.push(<span key={k++}>{line.slice(last)}</span>);

  return (
    <div className="whitespace-pre leading-relaxed text-zinc-800 dark:text-zinc-200">
      {nodes}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function Chords({
  source,
  fontSize,
  onSave,
}: {
  source: string;
  fontSize?: number;
  onSave?: (newSource: string) => void;
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
    <div className="my-3 overflow-hidden rounded-lg border border-zinc-200 bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900">
      {/* Toolbar */}
      <div className="flex items-center gap-1 border-b border-zinc-200 px-3 py-1.5 dark:border-zinc-700">
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
      </div>

      {/* Sheet */}
      <div className="overflow-x-auto p-3 font-mono" style={{ fontSize: fontSize ?? undefined }}>
        {lines.map((line, i) =>
          hasInlineChords(line) ? (
            <InlineLine key={i} line={line} semitones={semitones} />
          ) : isChordLine(line) ? (
            <ChordLine key={i} line={line} semitones={semitones} />
          ) : (
            <div
              key={i}
              className="whitespace-pre leading-relaxed text-zinc-800 dark:text-zinc-200"
            >
              {line || '\u00A0'}
            </div>
          )
        )}
      </div>
    </div>
  );
}
