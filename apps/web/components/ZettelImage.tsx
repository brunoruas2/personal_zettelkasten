'use client'

import React from 'react'
import { imageStore, fetchImage } from '../lib/imageSync'

/** Prefixo das referências locais no markdown. */
export const ZK_IMG_PREFIX = 'zk:img/'

export function isZkImageSrc(src: string): boolean {
  return src.startsWith(ZK_IMG_PREFIX)
}

export function zkImageId(src: string): string {
  return src.slice(ZK_IMG_PREFIX.length)
}

/**
 * Cache de object URLs com contagem de referências.
 *
 * Sem isso cada render criaria um blob URL novo e vazaria memória; com refcount
 * o URL só é revogado quando o último componente que o usa desmonta.
 */
const urlCache = new Map<string, { url: string; refs: number }>()

function acquireUrl(id: string, blob: Blob): string {
  const cached = urlCache.get(id)
  if (cached) {
    cached.refs++
    return cached.url
  }
  const url = URL.createObjectURL(blob)
  urlCache.set(id, { url, refs: 1 })
  return url
}

function releaseUrl(id: string): void {
  const cached = urlCache.get(id)
  if (!cached) return
  cached.refs--
  if (cached.refs <= 0) {
    URL.revokeObjectURL(cached.url)
    urlCache.delete(id)
  }
}

type State = 'loading' | 'ready' | 'missing'

/**
 * Resolve `zk:img/<id>` na ordem IndexedDB → API → placeholder.
 *
 * O `<img src>` é sempre um object URL do blob local, nunca a URL da API: uma
 * tag `<img>` não manda `Authorization: Bearer`, e o backend só aceita header.
 *
 * Só o preview usa isto. No editor a imagem vira um chip compacto — ver
 * ImageChipNodeView em TipTapEditor.tsx.
 */
export function ZettelImage({ id, alt }: { id: string; alt: string }) {
  const [url, setUrl] = React.useState<string | null>(null)
  const [state, setState] = React.useState<State>('loading')

  React.useEffect(() => {
    let cancelled = false
    let acquired = false

    const resolve = async () => {
      let blob: Blob | null = null
      try {
        blob = (await imageStore.get(id))?.blob ?? null
      } catch {
        blob = null
      }
      if (!blob) blob = await fetchImage(id)

      if (cancelled) return
      if (!blob) {
        setState('missing')
        return
      }
      acquired = true
      setUrl(acquireUrl(id, blob))
      setState('ready')
    }

    void resolve()

    return () => {
      cancelled = true
      if (acquired) releaseUrl(id)
    }
  }, [id])

  if (state === 'missing') {
    return (
      <span className="my-2 inline-flex items-center gap-2 rounded-lg border border-dashed border-zinc-300 px-3 py-2 text-sm text-zinc-500 dark:border-zinc-600 dark:text-zinc-400">
        <span aria-hidden>🖼</span>
        {alt ? `${alt} — imagem indisponível offline` : 'Imagem indisponível offline'}
      </span>
    )
  }

  if (state === 'loading' || !url) {
    // data-render-state="loading" é o sinal que /export/pdf usa para segurar o
    // window.print() até tudo estar resolvido (mesmo contrato do PlantUML).
    return (
      <span
        data-render-state="loading"
        className="my-2 inline-block h-24 w-40 animate-pulse rounded-lg bg-zinc-200 dark:bg-zinc-700"
      />
    )
  }

  return (
    <img
      src={url}
      alt={alt}
      loading="lazy"
      className="my-2 max-w-full rounded-lg border border-zinc-200 dark:border-zinc-700"
    />
  )
}
