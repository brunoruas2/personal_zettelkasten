'use client'

import React from 'react'
import { createPortal } from 'react-dom'
import {
  DARK_BG,
  LIGHT_BG,
  MAX_ZOOM,
  MIN_ZOOM,
  SKETCH_COLORS,
  SKETCH_SIZES,
  parseSketchScene,
  serializeSketchScene,
  themeColor,
  type SketchTheme,
  type Stroke,
} from '@zettelkasten/core'
import {
  SketchCanvas,
  type SketchCanvasHandle,
  type SketchEngineState,
  type SketchTool,
} from './SketchCanvas'
import { sceneToSvg } from '../lib/sketchRender'
import {
  drawingStore,
  saveDrawing,
  DrawingTooLargeError,
  type SaveDrawingResult,
} from '../lib/drawingSync'
import { DRAWING_MODAL_ATTR } from '../lib/embeddedFocus'

export interface DrawingEditorResult {
  /** `saved`: gravado no Dexie (mesmo que o servidor tenha recusado); `cancelled`: nada mudou. */
  outcome: 'saved' | 'cancelled'
  /** O desenho ainda não tinha conteúdo quando o editor abriu (criado por `/desenho`). */
  wasEmpty: boolean
}

interface Props {
  id: string
  onClose: (result: DrawingEditorResult) => void
}

type Phase =
  | { kind: 'loading' }
  | { kind: 'ready'; strokes: Stroke[] }
  // Cena do editor antigo (Excalidraw) ou ilegível: só o preview SVG, sem edição.
  | { kind: 'locked'; reason: 'legacy' | 'unreadable'; svgUrl: string | null }

const COLOR_NAMES: Record<string, string> = {
  '#1e1e1e': 'Preto',
  '#e03131': 'Vermelho',
  '#2f9e44': 'Verde',
  '#1971c2': 'Azul',
  '#f08c00': 'Laranja',
  '#9c36b5': 'Roxo',
}
const SIZE_NAMES: Record<number, string> = { 2: 'Fina', 4: 'Média', 8: 'Grossa' }

/** Passo dos botões e atalhos de zoom. */
const ZOOM_STEP = 1.25

const THEME_KEY = 'zettel_drawing_theme'

/**
 * Tema inicial do canvas: a escolha salva neste dispositivo ou, sem ela, o do
 * sistema. Todo acesso é protegido: sem `localStorage` (ou sem `matchMedia`) o
 * editor abre no claro e a escolha vale só naquela abertura.
 */
function readInitialTheme(): SketchTheme {
  try {
    const saved = localStorage.getItem(THEME_KEY)
    if (saved === 'dark' || saved === 'light') return saved
  } catch {
    // segue para o tema do sistema
  }
  try {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
  } catch {
    return 'light'
  }
}

function fullscreenSupported(el: HTMLElement | null): boolean {
  return !!el && typeof el.requestFullscreen === 'function'
}

/**
 * Editor de desenho: overlay `fixed` sobre um canvas 2D próprio (ver `SketchCanvas`).
 * Salvar e Cancelar são explícitos (sem autosave): salvar grava cena + SVG de
 * preview juntos no Dexie (ver `saveDrawing`).
 *
 * Em `lg:` abre como painel grande com margem; abaixo de `lg` já ocupa a viewport.
 * Tela cheia tira a margem e, onde a Fullscreen API existe, esconde também a
 * interface do navegador. A alternância só troca classes e chama a API — o canvas
 * não remonta, então traços e histórico sobrevivem.
 */
export function DrawingEditorModal({ id, onClose }: Props) {
  const rootRef = React.useRef<HTMLDivElement>(null)
  const canvasRef = React.useRef<SketchCanvasHandle>(null)
  const wasEmptyRef = React.useRef(true)
  const usedFullscreenApiRef = React.useRef(false)

  const [phase, setPhase] = React.useState<Phase>({ kind: 'loading' })
  const [eng, setEng] = React.useState<SketchEngineState>({
    canUndo: false,
    canRedo: false,
    empty: true,
    dirty: false,
    selectionCount: 0,
  })
  const [saving, setSaving] = React.useState(false)
  const [notice, setNotice] = React.useState<{ text: string; tone: 'error' | 'warn' } | null>(null)
  const [savedLocally, setSavedLocally] = React.useState(false)
  const [fullscreen, setFullscreen] = React.useState(false)
  const [penMode, setPenMode] = React.useState(false)
  const [tool, setTool] = React.useState<SketchTool>('pen')
  const [color, setColor] = React.useState<string>(SKETCH_COLORS[0])
  const [size, setSize] = React.useState<number>(4)
  const [zoom, setZoom] = React.useState(1)
  // Lazy: o valor tem que existir antes de o canvas montar (a primeira pintura já sai no tema certo).
  const [theme, setTheme] = React.useState<SketchTheme>(readInitialTheme)

  // Refs espelham o estado lido pelos listeners nativos, que não re-registram a cada render.
  const dirtyRef = React.useRef(false)
  dirtyRef.current = eng.dirty
  const engRef = React.useRef(eng)
  engRef.current = eng
  const savingRef = React.useRef(false)
  savingRef.current = saving
  const fullscreenRef = React.useRef(false)
  fullscreenRef.current = fullscreen

  // Scroll-lock do body (position: fixed + offset salvo), o padrão do LinkPickerModal.
  React.useEffect(() => {
    const scrollY = window.scrollY
    document.body.style.position = 'fixed'
    document.body.style.top = `-${scrollY}px`
    document.body.style.width = '100%'
    return () => {
      document.body.style.position = ''
      document.body.style.top = ''
      document.body.style.width = ''
      window.scrollTo(0, scrollY)
    }
  }, [])

  // O root recebe o foco: o teclado do modal (desfazer, Space, Alt+Enter) vive nele.
  React.useEffect(() => {
    rootRef.current?.focus()
  }, [])

  // Carrega a cena do Dexie. Vazia → canvas vazio; legada/ilegível → só o preview.
  React.useEffect(() => {
    let cancelled = false
    let svgUrl: string | null = null
    void (async () => {
      let record
      try {
        record = await drawingStore.get(id)
      } catch {
        record = undefined
      }
      if (cancelled) return
      wasEmptyRef.current = !record?.scene
      if (!record?.scene) {
        setPhase({ kind: 'ready', strokes: [] })
        return
      }
      const parsed = parseSketchScene(record.scene)
      if (parsed.kind === 'scene') {
        setPhase({ kind: 'ready', strokes: parsed.scene.strokes })
        return
      }
      if (record.svg) svgUrl = URL.createObjectURL(new Blob([record.svg], { type: 'image/svg+xml' }))
      setPhase({ kind: 'locked', reason: parsed.kind === 'legacy' ? 'legacy' : 'unreadable', svgUrl })
    })()
    return () => {
      cancelled = true
      if (svgUrl) URL.revokeObjectURL(svgUrl)
    }
  }, [id])

  // Estado de tela cheia derivado de `fullscreenchange`: o usuário também sai pelo Escape do navegador.
  React.useEffect(() => {
    const onFsChange = () => {
      const root = rootRef.current
      if (document.fullscreenElement === root) return
      if (usedFullscreenApiRef.current) {
        usedFullscreenApiRef.current = false
        setFullscreen(false)
      }
    }
    document.addEventListener('fullscreenchange', onFsChange)
    return () => {
      document.removeEventListener('fullscreenchange', onFsChange)
      if (document.fullscreenElement && document.fullscreenElement === rootRef.current) {
        void document.exitFullscreen().catch(() => {})
      }
    }
  }, [])

  const toggleFullscreen = React.useCallback(() => {
    const root = rootRef.current
    const next = !fullscreenRef.current
    setFullscreen(next)
    if (next) {
      if (fullscreenSupported(root)) {
        usedFullscreenApiRef.current = true
        void root!.requestFullscreen().catch(() => {
          // Recusado (gesto, política): fica só o layout de viewport inteira.
          usedFullscreenApiRef.current = false
        })
      }
    } else if (document.fullscreenElement === root) {
      usedFullscreenApiRef.current = false
      void document.exitFullscreen().catch(() => {})
    }
  }, [])

  const requestClose = React.useCallback(
    (outcome: 'saved' | 'cancelled') => {
      if (outcome === 'cancelled' && dirtyRef.current && !savedLocally) {
        if (!window.confirm('Descartar as alterações deste desenho?')) return
      }
      onClose({ outcome, wasEmpty: wasEmptyRef.current })
    },
    [onClose, savedLocally],
  )

  const requestCloseRef = React.useRef(requestClose)
  requestCloseRef.current = requestClose
  const toggleFullscreenRef = React.useRef(toggleFullscreen)
  const pickToolRef = React.useRef<(t: SketchTool) => void>(() => {})
  toggleFullscreenRef.current = toggleFullscreen

  // Teclado no root, na fase de bubble, com `stopPropagation`: nada dos atalhos
  // globais do pai (Alt+S/P/E/B/…) nem um overlay atrás do modal reage a uma tecla
  // que aconteceu aqui dentro.
  React.useEffect(() => {
    const root = rootRef.current
    if (!root) return
    const onKeyDown = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey
      // Atalhos de tecla simples: sem Ctrl/⌘/Alt (não colidem com Ctrl+E, Alt+E…) e só com
      // canvas na tela (o desenho legado não tem ferramentas).
      if (!mod && !e.altKey && canvasRef.current) {
        // R caneta, E mão, T selecionar, Q borracha (sem Shift, ignorando tecla segurada).
        if (!e.shiftKey && !e.repeat) {
          const next: SketchTool | null =
            e.code === 'KeyR' ? 'pen' : e.code === 'KeyE' ? 'hand' : e.code === 'KeyT' ? 'select' : e.code === 'KeyQ' ? 'eraser' : null
          if (next) {
            e.preventDefault()
            pickToolRef.current(next)
            e.stopPropagation()
            return
          }
        }
        // W desfaz, Shift+W refaz (segurar a tecla não desfaz tudo).
        if (e.code === 'KeyW' && !e.repeat) {
          e.preventDefault()
          if (e.shiftKey) canvasRef.current.redo()
          else canvasRef.current.undo()
          e.stopPropagation()
          return
        }
        // Com seleção: Delete/Backspace apagam, as setas movem (1 px de tela, 10 com Shift).
        if (engRef.current.selectionCount > 0) {
          if (e.key === 'Delete' || e.key === 'Backspace') {
            e.preventDefault()
            canvasRef.current.deleteSelection()
            e.stopPropagation()
            return
          }
          const step = e.shiftKey ? 10 : 1
          const arrow: [number, number] | null =
            e.key === 'ArrowLeft' ? [-step, 0] : e.key === 'ArrowRight' ? [step, 0] : e.key === 'ArrowUp' ? [0, -step] : e.key === 'ArrowDown' ? [0, step] : null
          if (arrow) {
            e.preventDefault()
            canvasRef.current.nudgeSelection(arrow[0], arrow[1])
            e.stopPropagation()
            return
          }
        }
      }
      if (e.altKey && e.code === 'Enter') {
        e.preventDefault()
        toggleFullscreenRef.current()
      } else if (mod && e.code === 'KeyD') {
        // Duplicar a seleção; sem preventDefault o navegador abriria "favoritar".
        e.preventDefault()
        canvasRef.current?.duplicateSelection()
      } else if (mod && e.code === 'KeyA') {
        e.preventDefault()
        if (canvasRef.current) {
          pickToolRef.current('select')
          canvasRef.current.selectAll()
        }
      } else if (mod && e.code === 'KeyZ') {
        e.preventDefault()
        if (e.shiftKey) canvasRef.current?.redo()
        else canvasRef.current?.undo()
      } else if (mod && (e.code === 'Equal' || e.code === 'NumpadAdd')) {
        // Zoom do desenho, não o da página: o preventDefault segura o atalho do navegador.
        e.preventDefault()
        canvasRef.current?.zoomBy(ZOOM_STEP)
      } else if (mod && (e.code === 'Minus' || e.code === 'NumpadSubtract')) {
        e.preventDefault()
        canvasRef.current?.zoomBy(1 / ZOOM_STEP)
      } else if (mod && (e.code === 'Digit0' || e.code === 'Numpad0')) {
        e.preventDefault()
        canvasRef.current?.resetZoom()
      } else if (e.ctrlKey && e.code === 'KeyY') {
        e.preventDefault()
        canvasRef.current?.redo()
      } else if (e.code === 'Space' && !e.altKey && !mod) {
        // Segurado, arrastar vira pan. `preventDefault` evita rolar a página e acionar botão focado.
        e.preventDefault()
        canvasRef.current?.setSpaceDown(true)
      } else if (e.key === 'Escape' && !e.defaultPrevented) {
        // Com fullscreen do navegador o Escape nem chega aqui: o navegador o consome.
        // Com seleção, o primeiro Esc só a limpa; o modal fecha no seguinte.
        if (engRef.current.selectionCount > 0) canvasRef.current?.clearSelection()
        else if (!document.fullscreenElement && !savingRef.current) requestCloseRef.current('cancelled')
      }
      e.stopPropagation()
    }
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'Space') canvasRef.current?.setSpaceDown(false)
      e.stopPropagation()
    }
    const onBlur = () => canvasRef.current?.setSpaceDown(false)
    root.addEventListener('keydown', onKeyDown)
    root.addEventListener('keyup', onKeyUp)
    window.addEventListener('blur', onBlur)
    return () => {
      root.removeEventListener('keydown', onKeyDown)
      root.removeEventListener('keyup', onKeyUp)
      window.removeEventListener('blur', onBlur)
    }
  }, [])

  const handleSave = async () => {
    const canvas = canvasRef.current
    if (!canvas || saving) return
    const scene = canvas.getScene()
    const out = sceneToSvg(scene)
    if (!out) {
      setNotice({ text: 'Desenhe algo antes de salvar.', tone: 'warn' })
      return
    }
    setSaving(true)
    setNotice(null)
    try {
      const result: SaveDrawingResult = await saveDrawing({
        id,
        scene: serializeSketchScene(scene),
        svg: out.svg,
        width: out.width,
        height: out.height,
      })
      if (result.sync === 'rejected') {
        // Já está salvo neste aparelho; só não foi para o servidor.
        setSavedLocally(true)
        setNotice({ text: result.error.message, tone: 'warn' })
        return
      }
      onClose({ outcome: 'saved', wasEmpty: wasEmptyRef.current })
    } catch (err) {
      setNotice({
        text:
          err instanceof DrawingTooLargeError
            ? err.message
            : 'Não foi possível salvar o desenho neste aparelho.',
        tone: 'error',
      })
    } finally {
      setSaving(false)
    }
  }

  const replaceLocked = () => {
    if (!window.confirm('Substituir este desenho por um novo? O antigo só é perdido quando você salvar o novo.')) return
    setPhase({ kind: 'ready', strokes: [] })
  }

  const pickTool = (t: SketchTool) => {
    setTool(t)
    canvasRef.current?.setTool(t)
  }
  pickToolRef.current = pickTool
  const pickColor = (c: string) => {
    setColor(c)
    canvasRef.current?.setColor(c)
    if (eng.selectionCount > 0) {
      // Há seleção: a cor vai para ela (e também para as próximas canetas), sem sair da seleção.
      canvasRef.current?.applyColorToSelection(c)
      return
    }
    setTool('pen')
    canvasRef.current?.setTool('pen')
  }
  const pickSize = (n: number) => {
    setSize(n)
    canvasRef.current?.setSize(n)
    if (eng.selectionCount > 0) canvasRef.current?.applySizeToSelection(n)
  }
  const togglePen = () => {
    const next = !penMode
    setPenMode(next)
    canvasRef.current?.setPenMode(next)
  }
  const toggleTheme = () => {
    const next: SketchTheme = theme === 'dark' ? 'light' : 'dark'
    setTheme(next)
    canvasRef.current?.setTheme(next)
    try {
      localStorage.setItem(THEME_KEY, next)
    } catch {
      // sem localStorage a escolha vale só nesta abertura
    }
  }
  const clearAll = () => {
    if (eng.empty) return
    if (window.confirm('Limpar todo o desenho? Dá para desfazer.')) canvasRef.current?.clear()
  }

  // Strings de classe completas (nada de `lg:${x}`): o Tailwind só vê literais.
  const wrapperClass = fullscreen
    ? 'fixed inset-0 z-50 bg-black/70 outline-none'
    : 'fixed inset-0 z-50 bg-black/70 outline-none lg:p-6'
  const panelClass = fullscreen
    ? 'flex h-[100dvh] w-full flex-col overflow-hidden bg-white dark:bg-zinc-900'
    : 'flex h-[100dvh] w-full flex-col overflow-hidden bg-white shadow-2xl dark:bg-zinc-900 lg:h-full lg:rounded-xl'

  const btn =
    'inline-flex h-9 items-center justify-center gap-1.5 rounded-lg border border-zinc-200 px-3 text-sm text-zinc-700 transition-colors hover:bg-zinc-100 disabled:opacity-40 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800'
  const btnLight =
    'inline-flex h-9 items-center justify-center gap-1.5 rounded-lg border border-zinc-200 px-3 text-sm text-zinc-700 transition-colors hover:bg-zinc-100'
  const btnOn = '!border-brand !bg-brand/10 text-brand-light'
  // mousedown não pode tirar o foco do root: é nele que o teclado do modal escuta.
  const keepFocus = (e: React.MouseEvent) => e.preventDefault()

  const ready = phase.kind === 'ready'

  return createPortal(
    <div
      ref={rootRef}
      tabIndex={-1}
      {...{ [DRAWING_MODAL_ATTR]: '' }}
      role="dialog"
      aria-modal="true"
      aria-label="Editor de desenho"
      className={wrapperClass}
    >
      <div className={panelClass}>
        <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-zinc-200 px-3 py-2 dark:border-zinc-800">
          <span className="mr-auto text-sm font-medium text-zinc-700 dark:text-zinc-200">
            Desenho
            {eng.dirty ? <span className="ml-2 text-xs font-normal text-amber-600 dark:text-amber-400">não salvo</span> : null}
          </span>

          {ready && (
            <>
              <div className="flex items-center gap-1" role="group" aria-label="Ferramenta">
                <button type="button" onMouseDown={keepFocus} onClick={() => pickTool('pen')} aria-pressed={tool === 'pen'} title="Caneta (R)" className={`${btn} ${tool === 'pen' ? btnOn : ''}`}>
                  ✏️<span className="hidden sm:inline">Caneta</span>
                </button>
                <button type="button" onMouseDown={keepFocus} onClick={() => pickTool('eraser')} aria-pressed={tool === 'eraser'} title="Borracha (Q): apaga o traço inteiro" className={`${btn} ${tool === 'eraser' ? btnOn : ''}`}>
                  🧽<span className="hidden sm:inline">Borracha</span>
                </button>
                <button type="button" onMouseDown={keepFocus} onClick={() => pickTool('hand')} aria-pressed={tool === 'hand'} title="Mão (E): arrastar para mover a vista" className={`${btn} ${tool === 'hand' ? btnOn : ''}`}>
                  ✋<span className="hidden sm:inline">Mão</span>
                </button>
                <button type="button" onMouseDown={keepFocus} onClick={() => pickTool('select')} aria-pressed={tool === 'select'} title="Selecionar (T): arraste uma área ou clique num traço" className={`${btn} ${tool === 'select' ? btnOn : ''}`}>
                  ⬚<span className="hidden sm:inline">Selecionar</span>
                </button>
              </div>

              {eng.selectionCount > 0 && (
                <div className="flex items-center gap-1" role="group" aria-label="Seleção">
                  <span className="px-1 text-xs text-zinc-500 dark:text-zinc-400" aria-live="polite">
                    {eng.selectionCount} {eng.selectionCount === 1 ? 'selecionado' : 'selecionados'}
                  </span>
                  <button type="button" onMouseDown={keepFocus} onClick={() => canvasRef.current?.duplicateSelection()} title="Duplicar a seleção (Ctrl+D)" aria-label="Duplicar a seleção" className={btn}>
                    ⧉<span className="hidden sm:inline">Duplicar</span>
                  </button>
                  <button type="button" onMouseDown={keepFocus} onClick={() => canvasRef.current?.deleteSelection()} title="Excluir a seleção (Delete)" aria-label="Excluir a seleção" className={btn}>
                    🗑<span className="hidden sm:inline">Excluir</span>
                  </button>
                </div>
              )}

              <div className="flex items-center gap-1" role="group" aria-label="Cor">
                {SKETCH_COLORS.map((c) => (
                  <button
                    key={c}
                    type="button"
                    onMouseDown={keepFocus}
                    onClick={() => pickColor(c)}
                    aria-label={COLOR_NAMES[c]}
                    aria-pressed={color === c && tool === 'pen'}
                    title={COLOR_NAMES[c]}
                    style={{ backgroundColor: themeColor(c, theme) }}
                    className={`h-7 w-7 rounded-full border-2 transition-transform ${color === c && tool === 'pen' ? 'scale-110 border-brand' : 'border-zinc-300 dark:border-zinc-600'}`}
                  />
                ))}
              </div>

              <div className="flex items-center gap-1" role="group" aria-label="Espessura">
                {SKETCH_SIZES.map((n) => (
                  <button
                    key={n}
                    type="button"
                    onMouseDown={keepFocus}
                    onClick={() => pickSize(n)}
                    aria-label={SIZE_NAMES[n]}
                    aria-pressed={size === n}
                    title={SIZE_NAMES[n]}
                    className={`${btn} !w-9 !px-0 ${size === n ? btnOn : ''}`}
                  >
                    <span className="block rounded-full bg-current" style={{ width: n + 3, height: n + 3 }} />
                  </button>
                ))}
              </div>

              <div className="flex items-center gap-1" role="group" aria-label="Histórico">
                <button type="button" onMouseDown={keepFocus} onClick={() => canvasRef.current?.undo()} disabled={!eng.canUndo} title="Desfazer (W ou Ctrl+Z)" aria-label="Desfazer" className={btn}>↶</button>
                <button type="button" onMouseDown={keepFocus} onClick={() => canvasRef.current?.redo()} disabled={!eng.canRedo} title="Refazer (Shift+W ou Ctrl+Shift+Z)" aria-label="Refazer" className={btn}>↷</button>
                <button type="button" onMouseDown={keepFocus} onClick={clearAll} disabled={eng.empty} title="Limpar tudo" aria-label="Limpar" className={btn}>🗑</button>
              </div>

              <div className="flex items-center gap-1" role="group" aria-label="Zoom">
                <button type="button" onMouseDown={keepFocus} onClick={() => canvasRef.current?.zoomBy(1 / ZOOM_STEP)} disabled={zoom <= MIN_ZOOM + 1e-6} title="Diminuir o zoom (Ctrl+-)" aria-label="Diminuir o zoom" className={btn}>−</button>
                <button type="button" onMouseDown={keepFocus} onClick={() => canvasRef.current?.resetZoom()} title="Voltar a 100% (Ctrl+0)" aria-label={`Zoom ${Math.round(zoom * 100)}%, voltar a 100%`} className={`${btn} min-w-[3.5rem] tabular-nums`}>{Math.round(zoom * 100)}%</button>
                <button type="button" onMouseDown={keepFocus} onClick={() => canvasRef.current?.zoomBy(ZOOM_STEP)} disabled={zoom >= MAX_ZOOM - 1e-6} title="Aumentar o zoom (Ctrl+=)" aria-label="Aumentar o zoom" className={btn}>+</button>
                <button type="button" onMouseDown={keepFocus} onClick={() => canvasRef.current?.fitToContent()} title="Enquadrar o desenho inteiro" className={btn}>Ajustar</button>
              </div>

              <button type="button" onMouseDown={keepFocus} onClick={togglePen} aria-pressed={penMode} title="Modo caneta: só a caneta desenha, a palma da mão é ignorada" className={`${btn} ${penMode ? btnOn : ''}`}>
                🖊<span className="hidden sm:inline">Só caneta</span>
              </button>
            </>
          )}

          <button
            type="button"
            onMouseDown={keepFocus}
            onClick={toggleTheme}
            aria-label={theme === 'dark' ? 'Usar tema claro' : 'Usar tema escuro'}
            aria-pressed={theme === 'dark'}
            title={theme === 'dark' ? 'Tema escuro (clique para o claro). O desenho é salvo com as cores originais.' : 'Tema claro (clique para o escuro)'}
            className={btn}
          >
            {theme === 'dark' ? '🌙' : '☀️'}
          </button>

          <button
            type="button"
            onMouseDown={keepFocus}
            onClick={toggleFullscreen}
            aria-pressed={fullscreen}
            aria-label={fullscreen ? 'Sair da tela cheia' : 'Tela cheia'}
            title={fullscreen ? 'Sair da tela cheia (Alt+Enter)' : 'Tela cheia (Alt+Enter)'}
            className={btn}
          >
            {fullscreen ? (
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="M8 3v3a2 2 0 0 1-2 2H3m18 0h-3a2 2 0 0 1-2-2V3m0 18v-3a2 2 0 0 1 2-2h3M3 16h3a2 2 0 0 1 2 2v3" />
              </svg>
            ) : (
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3" />
              </svg>
            )}
          </button>

          <button type="button" onMouseDown={keepFocus} onClick={() => requestClose(savedLocally ? 'saved' : 'cancelled')} disabled={saving} className={btn}>
            {savedLocally || !ready ? 'Fechar' : 'Cancelar'}
          </button>
          {ready && !savedLocally && (
            <button
              type="button"
              onMouseDown={keepFocus}
              onClick={() => void handleSave()}
              disabled={saving || eng.empty}
              className="inline-flex h-9 items-center justify-center rounded-lg bg-brand px-4 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-40"
            >
              {saving ? 'Salvando…' : 'Salvar'}
            </button>
          )}
        </div>

        {notice && (
          <div
            role="alert"
            className={`shrink-0 border-b px-3 py-2 text-sm ${
              notice.tone === 'error'
                ? 'border-red-200 bg-red-50 text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300'
                : 'border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-300'
            }`}
          >
            {notice.text}
          </div>
        )}

        {/* Fundo do canvas segue o tema; o aviso de desenho legado é sempre branco. */}
        <div
          className="relative min-h-0 flex-1"
          style={{ backgroundColor: ready && theme === 'dark' ? DARK_BG : LIGHT_BG }}
        >
          {phase.kind === 'loading' && (
            <div className="absolute inset-0 flex items-center justify-center text-sm text-zinc-500">Carregando…</div>
          )}

          {phase.kind === 'ready' && (
            <SketchCanvas
              ref={canvasRef}
              initialStrokes={phase.strokes}
              theme={theme}
              onStateChange={setEng}
              onZoomChange={setZoom}
              className="absolute inset-0"
            />
          )}

          {phase.kind === 'locked' && (
            <div className="absolute inset-0 flex flex-col items-center gap-4 overflow-auto p-6 text-center">
              <p className="max-w-md text-sm text-zinc-600">
                {phase.reason === 'legacy'
                  ? 'Este desenho foi criado no editor antigo e não pode ser editado aqui.'
                  : 'Não foi possível ler a cena deste desenho, então ele não pode ser editado.'}{' '}
                O preview continua valendo no texto.
              </p>
              {phase.svgUrl && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={phase.svgUrl} alt="Preview do desenho" className="max-h-[60%] max-w-full rounded-lg border border-zinc-200" />
              )}
              {/* Sem variantes dark: o aviso fica sobre branco mesmo com o sistema em escuro. */}
              <button type="button" onClick={replaceLocked} className={btnLight}>
                Substituir por novo desenho
              </button>
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body,
  )
}
