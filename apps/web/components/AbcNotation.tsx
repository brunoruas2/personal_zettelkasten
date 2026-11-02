'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { TuneObject } from 'abcjs';
import {
  claimAudio,
  defaultBpm,
  loadScorePlayer,
  preloadAbcjs,
  unlockAudio,
  type ScorePlayer,
} from '../lib/abcAudio';

interface Props {
  source: string;
}

type PlayState = 'idle' | 'loading' | 'playing' | 'paused';

const MIN_BPM = 30;
const MAX_BPM = 300;
const BPM_STEP = 10;
const PLAYING_CLASS = 'abcjs-playing';

export function AbcNotation({ source }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState(false);
  const [playState, setPlayState] = useState<PlayState>('idle');
  const [canPlay, setCanPlay] = useState(false);
  const [bpm, setBpm] = useState(120);

  const tuneRef = useRef<TuneObject | null>(null);
  const playerRef = useRef<ScorePlayer | null>(null);
  const releaseRef = useRef<(() => void) | null>(null);
  const litRef = useRef<HTMLElement[]>([]);
  const genRef = useRef(0);

  const highlight = useCallback((els: HTMLElement[]) => {
    for (const el of litRef.current) el.classList.remove(PLAYING_CLASS);
    for (const el of els) el.classList.add(PLAYING_CLASS);
    litRef.current = els;
  }, []);

  // Estável: é o que `claimAudio` guarda para parar este bloco quando outro toca.
  const stopPlayer = useCallback(() => {
    genRef.current++;
    playerRef.current?.stop();
    playerRef.current = null;
    releaseRef.current?.();
    releaseRef.current = null;
    highlight([]);
    setPlayState('idle');
  }, [highlight]);

  useEffect(() => {
    if (!containerRef.current) return;
    const el = containerRef.current;

    setReady(false);
    stopPlayer();
    let cancelled = false;
    preloadAbcjs().then((abcjs) => {
      if (cancelled) return;
      const [tune] = abcjs.renderAbc(el, source, {
        responsive: 'resize',
        foregroundColor: 'currentColor',
        paddingright: 0,
        paddingleft: 0,
      });
      tuneRef.current = tune ?? null;
      let playable = false;
      try {
        playable = !!tune && tune.getTotalBeats() > 0;
        if (tune) setBpm(defaultBpm(tune));
      } catch {
        playable = false;
      }
      setCanPlay(playable);
      setReady(true);
    });
    return () => {
      cancelled = true;
      stopPlayer();
    };
  }, [source, stopPlayer]);

  function handlePlay() {
    const tune = tuneRef.current;
    if (!tune || playState === 'loading') return;

    if (playState === 'playing') {
      playerRef.current?.pause();
      setPlayState('paused');
      return;
    }
    if (playState === 'paused' && playerRef.current) {
      releaseRef.current = claimAudio(stopPlayer);
      playerRef.current.start();
      setPlayState('playing');
      return;
    }

    // O iOS só libera o áudio na pilha síncrona do toque: antes de qualquer await.
    unlockAudio();
    setPlayState('loading');
    const gen = ++genRef.current;
    loadScorePlayer(tune, bpm, { onNote: highlight, onEnd: stopPlayer })
      .then((player) => {
        if (gen !== genRef.current) {
          player.stop();
          return;
        }
        playerRef.current = player;
        releaseRef.current = claimAudio(stopPlayer);
        player.start();
        setPlayState('playing');
      })
      .catch((err) => {
        console.warn('[AbcNotation] não foi possível tocar', err);
        if (gen === genRef.current) setPlayState('idle');
      });
  }

  function changeBpm(delta: number) {
    setBpm((v) => Math.min(MAX_BPM, Math.max(MIN_BPM, v + delta)));
    // O andamento vale a partir do próximo play: descarta o áudio já preparado.
    if (playState !== 'idle') stopPlayer();
  }

  const btn =
    'flex h-7 min-w-7 items-center justify-center rounded-md px-1.5 text-xs font-bold text-zinc-600 transition-colors hover:bg-zinc-100 disabled:opacity-40 disabled:hover:bg-transparent dark:text-zinc-300 dark:hover:bg-zinc-800';
  const playIcon = playState === 'playing' ? '⏸' : playState === 'loading' ? '…' : '▶';
  const playLabel = playState === 'playing' ? 'Pausar' : 'Tocar partitura';

  return (
    <div data-render-state={ready ? 'ok' : 'loading'} className="my-3 overflow-hidden rounded-lg border border-zinc-200 bg-white dark:border-zinc-700 dark:bg-zinc-950">
      <div className="flex items-center justify-between gap-2 border-b border-zinc-200 px-3 py-1 dark:border-zinc-700">
        <span className="text-xs text-zinc-400">partitura</span>
        <div className="flex items-center gap-1" data-no-pan>
          <button
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => changeBpm(-BPM_STEP)}
            disabled={!canPlay || bpm <= MIN_BPM}
            aria-label="Diminuir andamento"
            className={btn}
          >
            −
          </button>
          <span className="min-w-[3.5rem] text-center text-xs tabular-nums text-zinc-500 dark:text-zinc-400">♩ = {bpm}</span>
          <button
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => changeBpm(BPM_STEP)}
            disabled={!canPlay || bpm >= MAX_BPM}
            aria-label="Aumentar andamento"
            className={btn}
          >
            +
          </button>
          <button
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={handlePlay}
            disabled={!canPlay || playState === 'loading'}
            aria-label={playLabel}
            title={playLabel}
            className={`${btn} ml-1 bg-brand/10 text-brand hover:bg-brand/20 dark:text-brand-light`}
          >
            {playIcon}
          </button>
        </div>
      </div>
      <div
        ref={containerRef}
        className="overflow-x-auto px-3 py-2 text-zinc-900 dark:text-zinc-100 [&_svg]:max-w-full [&_.abcjs-playing]:fill-brand [&_.abcjs-playing]:stroke-brand [&_.abcjs-playing_*]:fill-brand [&_.abcjs-playing_*]:stroke-brand"
      />
    </div>
  );
}
