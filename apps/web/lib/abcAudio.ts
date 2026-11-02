import type { TuneObject } from 'abcjs';

/**
 * Áudio das partituras ```abc: `abcjs.synth` com o soundfont de piano vendorizado
 * (um mp3 por nota, precacheado pelo SW). Tudo no cliente, tudo carregado sob demanda.
 *
 * O iOS só libera o `AudioContext` dentro do handler do gesto: quem chama
 * `unlockAudio()` precisa estar na pilha síncrona do clique/toque, antes de
 * qualquer `await`. Por isso o módulo do abcjs é pré-carregado (`preloadAbcjs`)
 * quando o bloco ou o teclado aparecem — no gesto ele já está em memória.
 */

export const SOUNDFONT_URL = '/vendor/abc-soundfont/';

/** As notas vêm do FluidR3, que o abcjs compensa com ×3 quando usa a URL padrão. */
const VOLUME_MULTIPLIER = 3;

type Abcjs = typeof import('abcjs');

let abcjsMod: Abcjs | null = null;
let abcjsPromise: Promise<Abcjs> | null = null;

export function preloadAbcjs(): Promise<Abcjs> {
  if (!abcjsPromise) {
    abcjsPromise = import('abcjs').then((m) => {
      abcjsMod = m;
      return m;
    });
    abcjsPromise.catch(() => {
      abcjsPromise = null; // permite tentar de novo depois de uma falha de rede
    });
  }
  return abcjsPromise;
}

/**
 * Cria/retoma o `AudioContext`. Síncrona de propósito (ver o cabeçalho): só faz
 * algo se o abcjs já estiver carregado. Devolve `false` sem suporte a áudio.
 */
export function unlockAudio(): boolean {
  if (!abcjsMod || !abcjsMod.synth.supportsAudio()) return false;
  const ac = abcjsMod.synth.activeAudioContext();
  if (ac.state === 'suspended') void ac.resume();
  return true;
}

// Um áudio de partitura por vez na página.
let activeStop: (() => void) | null = null;

/** Registra `stop` como o áudio ativo e para o anterior. Devolve o `release`. */
export function claimAudio(stop: () => void): () => void {
  if (activeStop && activeStop !== stop) activeStop();
  activeStop = stop;
  return () => {
    if (activeStop === stop) activeStop = null;
  };
}

/** Toca uma nota avulsa (MIDI), piano. `false` se não foi possível. */
export async function playNote(midi: number): Promise<boolean> {
  try {
    const abcjs = await preloadAbcjs();
    unlockAudio();
    await abcjs.synth.playEvent(
      [{ pitch: midi, start: 0, duration: 0.25, gap: 0, volume: 127, instrument: 0, cents: 0 }],
      undefined,
      2000,
      SOUNDFONT_URL,
    );
    return true;
  } catch (err) {
    console.warn('[abcAudio] playNote falhou', err);
    return false;
  }
}

let warmed = false;

/** Carrega e decodifica a oitava central (C4–B4), para a primeira tecla soar sem atraso. */
export async function warmUp(): Promise<void> {
  if (warmed) return;
  try {
    const abcjs = await preloadAbcjs();
    const seq = new abcjs.synth.SynthSequence();
    const track = seq.addTrack() as unknown as number;
    seq.setInstrument(track, 0);
    for (let midi = 60; midi <= 71; midi++) seq.appendNote(track, midi, 0.25, 0, 0);
    const buf = new abcjs.synth.CreateSynth();
    await buf.init({
      sequence: seq as unknown as import('abcjs').AudioSequence,
      millisecondsPerMeasure: 2000,
      options: { soundFontUrl: SOUNDFONT_URL },
    });
    warmed = true;
  } catch (err) {
    console.warn('[abcAudio] warmUp falhou', err);
  }
}

export interface ScorePlayer {
  /** Começa ou retoma do ponto onde parou. */
  start(): void;
  pause(): void;
  /** Para e libera o áudio e o temporizador. */
  stop(): void;
}

export interface ScorePlayerCallbacks {
  /** Elementos SVG da nota atual; `[]` para limpar. */
  onNote(elements: HTMLElement[]): void;
  /** O áudio terminou sozinho. */
  onEnd(): void;
}

/** Andamento padrão da partitura (batidas por minuto, como o `getBpm` do abcjs). */
export function defaultBpm(visualObj: TuneObject): number {
  const perMeasure = visualObj.getBeatsPerMeasure();
  const ms = visualObj.millisecondsPerMeasure();
  return Math.round((perMeasure / ms) * 60000);
}

/**
 * Prepara o áudio da partitura (baixa/decodifica as notas usadas) e devolve o
 * controle. `unlockAudio()` já deve ter sido chamada no gesto que originou isto.
 */
export async function loadScorePlayer(
  visualObj: TuneObject,
  bpm: number,
  cb: ScorePlayerCallbacks,
): Promise<ScorePlayer> {
  const abcjs = await preloadAbcjs();
  const millisecondsPerMeasure = (visualObj.getBeatsPerMeasure() * 60000) / bpm;

  let ended = false;
  let timer: InstanceType<Abcjs['TimingCallbacks']> | null = null;
  const synth = new abcjs.synth.CreateSynth();
  await abcjs.synth.activeAudioContext().resume();
  await synth.init({
    visualObj,
    millisecondsPerMeasure,
    options: {
      soundFontUrl: SOUNDFONT_URL,
      soundFontVolumeMultiplier: VOLUME_MULTIPLIER,
      onEnded: () => {
        if (ended) return;
        ended = true;
        timer?.stop();
        cb.onNote([]);
        cb.onEnd();
      },
    },
  });
  await synth.prime();

  timer = new abcjs.TimingCallbacks(visualObj, {
    qpm: bpm,
    eventCallback: (ev) => {
      if (!ev) return undefined; // fim: quem encerra é o `onEnded` do synth
      cb.onNote((ev.elements ?? []).flat());
      return undefined;
    },
  });

  return {
    start() {
      ended = false;
      synth.start();
      timer?.start();
    },
    pause() {
      synth.pause();
      timer?.pause();
    },
    stop() {
      ended = true;
      try {
        synth.stop();
      } catch {
        /* já parado */
      }
      timer?.stop();
      cb.onNote([]);
    },
  };
}
