'use client'

import React from 'react'
import { DrawingEditContext } from '../components/DrawingBlock'
import { DrawingEditorModal, type DrawingEditorResult } from '../components/DrawingEditorModal'

/**
 * Hospeda o modal de desenho: `open(id)` abre o editor e `modal` é o elemento a
 * renderizar. `onClosed` recebe o resultado, o que deixa quem criou o desenho
 * (o `/desenho` do TipTap) limpar a referência se o usuário cancelou sem desenhar.
 */
export function useDrawingEditHost(onClosed?: (id: string, result: DrawingEditorResult) => void) {
  const [openId, setOpenId] = React.useState<string | null>(null)
  const onClosedRef = React.useRef(onClosed)
  onClosedRef.current = onClosed

  const open = React.useCallback((id: string) => setOpenId(id), [])

  const modal = openId ? (
    <DrawingEditorModal
      key={openId}
      id={openId}
      onClose={(result) => {
        setOpenId(null)
        onClosedRef.current?.(openId, result)
      }}
    />
  ) : null

  return { open, modal }
}

/**
 * Torna editáveis os desenhos dos filhos: clicar no preview abre o editor.
 * Sem este wrapper (SearchPalette, export PDF) o `DrawingBlock` é só leitura.
 */
export function DrawingEditHost({ children }: { children: React.ReactNode }) {
  const { open, modal } = useDrawingEditHost()
  return (
    <DrawingEditContext.Provider value={open}>
      {children}
      {modal}
    </DrawingEditContext.Provider>
  )
}
