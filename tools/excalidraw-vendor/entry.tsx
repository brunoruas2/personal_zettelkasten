// Entry do bundle vendorizado. Expõe window.ZkExcalidraw — o app nunca importa @excalidraw/*.
import * as React from 'react'
import { createRoot, type Root } from 'react-dom/client'
import {
  Excalidraw,
  exportToSvg,
  serializeAsJSON,
  getSceneVersion,
  restore,
} from '@excalidraw/excalidraw'
import './node_modules/@excalidraw/excalidraw/dist/prod/index.css'

type Theme = 'light' | 'dark'

interface MountOptions {
  /** JSON string de uma cena salva (serializeAsJSON), ou null/'' para cena vazia. */
  scene?: string | null
  theme?: Theme
  langCode?: string
  onChange?: (info: { version: number; empty: boolean }) => void
}

interface Handle {
  destroy(): void
  /** Cena serializada como JSON (type "excalidraw"). */
  getScene(): string
  /** Preview SVG da cena atual (string). Rejeita se a cena estiver vazia. */
  exportSvg(opts?: { dark?: boolean }): Promise<{ svg: string; width: number; height: number }>
  setTheme(theme: Theme): void
  setPenMode(on: boolean): void
  isEmpty(): boolean
  version(): number
}

function parseInitial(scene?: string | null) {
  if (!scene) return null
  try {
    const data = JSON.parse(scene)
    const restored = restore(data, null, null)
    return {
      elements: restored.elements,
      appState: { ...restored.appState, collaborators: new Map() },
      files: restored.files,
    }
  } catch {
    return null
  }
}

function mount(el: HTMLElement, opts: MountOptions = {}): Handle {
  const root: Root = createRoot(el)
  let api: any = null
  let theme: Theme = opts.theme ?? 'light'
  const initialData = parseInitial(opts.scene)

  const visibleElements = () =>
    (api?.getSceneElements?.() ?? []).filter((e: any) => !e.isDeleted)

  const render = () => {
    root.render(
      React.createElement(Excalidraw as any, {
        excalidrawAPI: (a: any) => {
          api = a
        },
        initialData,
        theme,
        langCode: opts.langCode ?? 'pt-BR',
        // Sem abrir/salvar arquivo, exportar imagem, colaborar ou inserir imagem.
        UIOptions: {
          canvasActions: {
            loadScene: false,
            saveToActiveFile: false,
            export: false,
            saveAsImage: false,
            toggleTheme: false,
            clearCanvas: true,
          },
          tools: { image: false },
        },
        handleKeyboardGlobally: false,
        autoFocus: true,
        onChange: (elements: readonly any[]) => {
          const live = elements.filter((e) => !e.isDeleted)
          opts.onChange?.({ version: getSceneVersion(elements as any), empty: live.length === 0 })
        },
      }),
    )
  }
  render()

  return {
    destroy() {
      root.unmount()
      api = null
    },
    getScene() {
      if (!api) return ''
      return serializeAsJSON(
        api.getSceneElements(),
        api.getAppState(),
        api.getFiles(),
        'local',
      )
    },
    async exportSvg({ dark = false } = {}) {
      const elements = visibleElements()
      if (!elements.length) throw new Error('empty-scene')
      const svg = await exportToSvg({
        elements,
        appState: {
          ...api.getAppState(),
          exportBackground: true,
          exportWithDarkMode: dark,
          viewBackgroundColor: dark ? '#121212' : '#ffffff',
        },
        files: api.getFiles(),
        exportPadding: 16,
      })
      const width = Number(svg.getAttribute('width')) || 0
      const height = Number(svg.getAttribute('height')) || 0
      return { svg: new XMLSerializer().serializeToString(svg), width, height }
    },
    setTheme(t) {
      theme = t
      render()
    },
    setPenMode(on) {
      api?.updateScene?.({ appState: { penMode: on, penDetected: on } })
    },
    isEmpty() {
      return visibleElements().length === 0
    },
    version() {
      return api ? getSceneVersion(api.getSceneElements()) : 0
    },
  }
}

;(window as any).ZkExcalidraw = { mount }
export { mount }
