'use client'

import React from 'react'
import { createPortal } from 'react-dom'
import { mountExcalidraw, type ExcalidrawHandle, type ExcalidrawTheme } from '../lib/excalidrawEngine'
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

type Phase = 'loading' | 'ready' | 'error'

function systemTheme(): ExcalidrawTheme {
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
 * Editor de desenho: overlay `fixed` que monta o Excalidraw vendorizado sob demanda
 * e o destrói ao fechar — o engine nunca fica vivo fora do modal. Salvar e
 * Cancelar são explícitos (sem autosave): salvar grava cena + SVG de preview
 * juntos no Dexie (ver `saveDrawing`).
 *
 * Em `lg:` abre como painel grande com margem; abaixo de `lg` já ocupa a viewport.
 * Tela cheia tira a margem e, onde a Fullscreen API existe, esconde também a
 * interface do navegador. A alternância só troca classes e chama a API — o
 * Excalidraw não remonta, então cena e alterações não salvas sobrevivem.
 */
export function DrawingEditorModal({ id, onClose }: Props) {
  const rootRef = React.useRef<HTMLDivElement>(null)
  const hostRef = React.useRef<HTMLDivElement>(null)
  const handleRef = React.useRef<ExcalidrawHandle | null>(null)
  const baseVersionRef = React.useRef<number | null>(null)
  const wasEmptyRef = React.useRef(true)
  const usedFullscreenApiRef = React.useRef(false)

  const [phase, setPhase] = React.useState<Phase>('loading')
  const [loadError, setLoadError] = React.useState('')
  const [attempt, setAttempt] = React.useState(0)
  const [dirty, setDirty] = React.useState(false)
  const [empty, setEmpty] = React.useState(true)
  const [saving, setSaving] = React.useState(false)
  const [notice, setNotice] = React.useState<{ text: string; tone: 'error' | 'warn' } | null>(null)
  const [savedLocally, setSavedLocally] = React.useState(false)
  const [fullscreen, setFullscreen] = React.useState(false)
  const [penMode, setPenMode] = React.useState(false)

  // Refs espelham o estado lido pelos listeners nativos, que não podem re-registrar a cada tecla.
  const dirtyRef = React.useRef(false)
  dirtyRef.current = dirty
  const savingRef = React.useRef(false)
  savingRef.current = saving

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

  // Monta o Excalidraw com a cena do Dexie; destrói no cleanup.
  React.useEffect(() => {
    let cancelled = false
    let handle: ExcalidrawHandle | null = null
    setPhase('loading')

    const init = async () => {
      try {
        const record = await drawingStore.get(id)
        wasEmptyRef.current = !record?.scene
        const el = hostRef.current
        if (!el || cancelled) return
        handle = await mountExcalidraw(el, {
          scene: record?.scene || null,
          theme: systemTheme(),
          onChange: ({ version, empty: isEmpty }) => {
            // A primeira chamada é a carga inicial: vira a linha de base do "alterado".
            if (baseVersionRef.current === null) baseVersionRef.current = version
            setDirty(version !== baseVersionRef.current)
            setEmpty(isEmpty)
          },
        })
        if (cancelled) {
          handle.destroy()
          handle = null
          return
        }
        handleRef.current = handle
        setPhase('ready')
      } catch (err) {
        if (cancelled) return
        setLoadError(err instanceof Error ? err.message : 'erro desconhecido')
        setPhase('error')
      }
    }
    void init()

    return () => {
      cancelled = true
      handleRef.current = null
      baseVersionRef.current = null
      handle?.destroy()
    }
  }, [id, attempt])

  // O tema do app segue o sistema (darkMode: 'media'); o editor acompanha.
  React.useEffect(() => {
    let mql: MediaQueryList
    try {
      mql = window.matchMedia('(prefers-color-scheme: dark)')
    } catch {
      return
    }
    const onChange = () => handleRef.current?.setTheme(mql.matches ? 'dark' : 'light')
    mql.addEventListener('change', onChange)
    return () => mql.removeEventListener('change', onChange)
  }, [])

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

  const fullscreenRef = React.useRef(false)
  fullscreenRef.current = fullscreen

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
  toggleFullscreenRef.current = toggleFullscreen

  // Teclado no root, na fase de bubble: o Excalidraw escuta no próprio container
  // (handleKeyboardGlobally: false), então já rodou antes daqui. `stopPropagation`
  // impede que os atalhos globais do pai (Alt+S/P/E/B/…) e o Escape de qualquer
  // overlay atrás do modal reajam a algo que aconteceu dentro dele.
  React.useEffect(() => {
    const root = rootRef.current
    if (!root) return
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.altKey && e.code === 'Enter') {
        e.preventDefault()
        toggleFullscreenRef.current()
      } else if (e.key === 'Escape' && !e.defaultPrevented) {
        const t = e.target
        const editingText =
          t instanceof HTMLElement &&
          (t.isContentEditable || t.tagName === 'TEXTAREA' || t.tagName === 'INPUT')
        // Em texto, o Escape é do Excalidraw (sair da edição do rótulo). Com
        // fullscreen do navegador o Escape nem chega aqui: o navegador o consome.
        if (!editingText && !document.fullscreenElement && !savingRef.current) {
          requestCloseRef.current('cancelled')
        }
      }
      e.stopPropagation()
    }
    root.addEventListener('keydown', onKeyDown)
    return () => root.removeEventListener('keydown', onKeyDown)
  }, [])

  const handleSave = async () => {
    const handle = handleRef.current
    if (!handle || saving) return
    if (handle.isEmpty()) {
      setNotice({ text: 'Desenhe algo antes de salvar.', tone: 'warn' })
      return
    }
    setSaving(true)
    setNotice(null)
    try {
      const scene = handle.getScene()
      const { svg, width, height } = await handle.exportSvg({ dark: false })
      const result: SaveDrawingResult = await saveDrawing({ id, scene, svg, width, height })
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

  const togglePen = () => {
    const next = !penMode
    setPenMode(next)
    handleRef.current?.setPenMode(next)
  }

  // Strings de classe completas (nada de `lg:${x}`): o Tailwind só vê literais.
  const wrapperClass = fullscreen
    ? 'fixed inset-0 z-50 bg-black/70'
    : 'fixed inset-0 z-50 bg-black/70 lg:p-6'
  const panelClass = fullscreen
    ? 'flex h-[100dvh] w-full flex-col overflow-hidden bg-white dark:bg-zinc-900'
    : 'flex h-[100dvh] w-full flex-col overflow-hidden bg-white shadow-2xl dark:bg-zinc-900 lg:h-full lg:rounded-xl'

  const headerBtn =
    'inline-flex h-9 items-center justify-center gap-1.5 rounded-lg border border-zinc-200 px-3 text-sm text-zinc-700 transition-colors hover:bg-zinc-100 disabled:opacity-40 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800'

  return createPortal(
    <div
      ref={rootRef}
      {...{ [DRAWING_MODAL_ATTR]: '' }}
      role="dialog"
      aria-modal="true"
      aria-label="Editor de desenho"
      className={wrapperClass}
    >
      <div className={panelClass}>
        <div className="flex shrink-0 items-center gap-2 border-b border-zinc-200 px-3 py-2 dark:border-zinc-800">
          <span className="mr-auto text-sm font-medium text-zinc-700 dark:text-zinc-200">
            Desenho{dirty ? <span className="ml-2 text-xs font-normal text-amber-600 dark:text-amber-400">não salvo</span> : null}
          </span>

          <button
            type="button"
            onClick={togglePen}
            disabled={phase !== 'ready'}
            aria-pressed={penMode}
            title="Modo caneta: ignora toques da palma da mão"
            className={`${headerBtn} ${penMode ? '!border-brand !bg-brand/10 text-brand-light' : ''}`}
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M12 20h9" />
              <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
            </svg>
            <span className="hidden sm:inline">Caneta</span>
          </button>

          <button
            type="button"
            onClick={toggleFullscreen}
            aria-pressed={fullscreen}
            aria-label={fullscreen ? 'Sair da tela cheia' : 'Tela cheia'}
            title={fullscreen ? 'Sair da tela cheia (Alt+Enter)' : 'Tela cheia (Alt+Enter)'}
            className={headerBtn}
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

          <button type="button" onClick={() => requestClose(savedLocally ? 'saved' : 'cancelled')} disabled={saving} className={headerBtn}>
            {savedLocally ? 'Fechar' : 'Cancelar'}
          </button>
          {!savedLocally && (
            <button
              type="button"
              onClick={() => void handleSave()}
              disabled={phase !== 'ready' || saving || empty}
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

        <div className="relative min-h-0 flex-1">
          {/* touch-action travado: gestos de desenho não rolam a página atrás. */}
          <div ref={hostRef} className="absolute inset-0" style={{ touchAction: 'none', overscrollBehavior: 'contain' }} />
          {phase === 'loading' && (
            <div className="absolute inset-0 flex items-center justify-center bg-white text-sm text-zinc-500 dark:bg-zinc-900 dark:text-zinc-400">
              Carregando editor…
            </div>
          )}
          {phase === 'error' && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-white px-6 text-center text-sm text-zinc-600 dark:bg-zinc-900 dark:text-zinc-300">
              <p>Não foi possível carregar o editor de desenho ({loadError}).</p>
              <button type="button" onClick={() => setAttempt((n) => n + 1)} className={headerBtn}>
                Tentar de novo
              </button>
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body,
  )
}
