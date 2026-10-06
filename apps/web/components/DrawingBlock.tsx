'use client'

import React from 'react'
import { drawingStore, fetchDrawing, subscribeDrawing } from '../lib/drawingSync'
import { ZoomModal } from './DiagramFrame'

/** Prefixo das referências a desenho no markdown: `![alt](zk:draw/<id>)`. */
export const ZK_DRAW_PREFIX = 'zk:draw/'

export function isZkDrawingSrc(src: string): boolean {
  return src.startsWith(ZK_DRAW_PREFIX)
}

export function zkDrawingId(src: string): string {
  return src.slice(ZK_DRAW_PREFIX.length)
}

/**
 * Quem sabe abrir o editor de desenho fornece isto por context (como
 * `WikiLinkActionContext`), sem atravessar os call sites de `renderInline`.
 * Sem provider — `SearchPalette`, preview de filhos — o desenho é só leitura e
 * clicar nele não abre nada.
 */
export const DrawingEditContext = React.createContext<((id: string) => void) | null>(null)

/**
 * Cache de object URLs com contagem de referências, como no ZettelImage. A
 * chave inclui `updatedAt`: editar o desenho gera outro SVG e, portanto, outro URL.
 */
const urlCache = new Map<string, { url: string; refs: number }>()

function acquireUrl(key: string, svg: string): string {
  const cached = urlCache.get(key)
  if (cached) {
    cached.refs++
    return cached.url
  }
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }))
  urlCache.set(key, { url, refs: 1 })
  return url
}

function releaseUrl(key: string): void {
  const cached = urlCache.get(key)
  if (!cached) return
  cached.refs--
  if (cached.refs <= 0) {
    URL.revokeObjectURL(cached.url)
    urlCache.delete(key)
  }
}

type State =
  | { status: 'loading' }
  | { status: 'missing' }
  | { status: 'empty' }
  | { status: 'ready'; url: string; width: number; height: number }

/**
 * Preview de um desenho: o SVG gravado junto da cena, renderizado como `<img>`
 * de um object URL — nunca `dangerouslySetInnerHTML`. SVG em `<img>` não executa
 * script nem busca recurso externo, o que importa porque o SVG pode vir do
 * servidor, de outro dispositivo. Não carrega o editor de desenho: a leitura só lê o
 * Dexie (ou `GET /api/drawings/{id}` quando o registro não existe aqui).
 */
export function DrawingBlock({ id, alt }: { id: string; alt: string }) {
  const onEdit = React.useContext(DrawingEditContext)
  const [state, setState] = React.useState<State>({ status: 'loading' })
  const [zoomed, setZoomed] = React.useState(false)

  React.useEffect(() => {
    let cancelled = false
    let heldKey: string | null = null

    const release = () => {
      if (heldKey) releaseUrl(heldKey)
      heldKey = null
    }

    const resolve = async () => {
      let record = null
      try {
        record = (await drawingStore.get(id)) ?? null
      } catch {
        record = null
      }
      if (!record) record = await fetchDrawing(id)
      if (cancelled) return
      if (!record) {
        release()
        setState({ status: 'missing' })
        return
      }
      if (!record.svg) {
        release()
        setState({ status: 'empty' })
        return
      }
      const key = `${record.id}@${record.updatedAt}`
      if (key !== heldKey) {
        const url = acquireUrl(key, record.svg)
        release()
        heldKey = key
        setState({ status: 'ready', url, width: record.width, height: record.height })
      }
    }

    void resolve()
    const unsubscribe = subscribeDrawing(id, () => void resolve())

    return () => {
      cancelled = true
      unsubscribe()
      release()
    }
  }, [id])

  const editButton = onEdit && (
    <button
      type="button"
      onClick={() => onEdit(id)}
      className="no-print absolute top-2 right-11 flex items-center justify-center w-8 h-8 lg:w-7 lg:h-7 rounded-md bg-zinc-100 dark:bg-zinc-800 text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover:opacity-100 transition-opacity"
      aria-label="Editar desenho"
      title="Editar desenho"
    >
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 20h9" />
        <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
      </svg>
    </button>
  )

  if (state.status === 'missing') {
    return (
      <span className="my-2 inline-flex items-center gap-2 rounded-lg border border-dashed border-zinc-300 px-3 py-2 text-sm text-zinc-500 dark:border-zinc-600 dark:text-zinc-400">
        <span aria-hidden>✏️</span>
        {alt ? `${alt} — desenho indisponível offline` : 'Desenho indisponível offline'}
      </span>
    )
  }

  if (state.status === 'empty') {
    return (
      <span className="group relative my-2 inline-flex items-center gap-2 rounded-lg border border-dashed border-zinc-300 px-3 py-2 text-sm text-zinc-500 dark:border-zinc-600 dark:text-zinc-400">
        <span aria-hidden>✏️</span>
        {alt || 'Desenho vazio'}
        {onEdit && (
          <button type="button" onClick={() => onEdit(id)} className="underline text-brand-light">
            desenhar
          </button>
        )}
      </span>
    )
  }

  if (state.status === 'loading') {
    // data-render-state="loading" é o sinal que /export/pdf usa para segurar o
    // window.print() até tudo estar resolvido (mesmo contrato do ZettelImage).
    return (
      <span
        data-render-state="loading"
        className="my-2 inline-block h-24 w-40 animate-pulse rounded-lg bg-zinc-200 dark:bg-zinc-700"
      />
    )
  }

  return (
    <>
      <span className="group relative my-2 inline-block max-w-full align-top">
        <img
          src={state.url}
          alt={alt}
          width={state.width || undefined}
          height={state.height || undefined}
          loading="lazy"
          onClick={onEdit ? () => onEdit(id) : undefined}
          className={`h-auto max-w-full rounded-lg border border-zinc-200 bg-white dark:border-zinc-700 ${onEdit ? 'cursor-pointer' : ''}`}
        />
        {editButton}
        <button
          type="button"
          onClick={() => setZoomed(true)}
          className="no-print absolute top-2 right-2 flex items-center justify-center w-8 h-8 lg:w-7 lg:h-7 rounded-md bg-zinc-100 dark:bg-zinc-800 text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover:opacity-100 transition-opacity"
          aria-label="Ampliar desenho"
          title="Ampliar"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z" />
            <circle cx="12" cy="12" r="3" />
          </svg>
        </button>
      </span>
      {zoomed && (
        <ZoomModal onClose={() => setZoomed(false)}>
          <img src={state.url} alt={alt} className="h-full w-full object-contain" draggable={false} />
        </ZoomModal>
      )}
    </>
  )
}
