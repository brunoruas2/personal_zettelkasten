'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { selectEmbeddableChildren, type Zettel } from '@zettelkasten/core';
import { useZettelStore } from '../store/useZettelStore';

const STORAGE_KEY = 'zettel_embed_children';

interface Options {
  /** Id do zettel pai; `''` em /zettel/new, onde ele ainda não existe. */
  parentId: string;
  body: string;
  /**
   * true no leitor: a relação vem da tabela de links persistida. false nos
   * editores: o corpo em edição (ainda não salvo) é a verdade e a tabela está
   * defasada.
   */
  useLinkTable: boolean;
}

export interface EmbeddedChildrenState {
  children: Zettel[];
  hasChildren: boolean;
  globalOn: boolean;
  toggleGlobal: () => void;
  isOpen: (id: string) => boolean;
  toggleChild: (id: string) => void;
  /** Devolve o filho embutível que um `[[título]]` resolve, se houver. */
  childForTitle: (title: string) => Zettel | undefined;
}

/**
 * Estado compartilhado do recurso "renderizar filhos dentro do pai": quais
 * filhos existem, o toggle global (persistido) e o estado por filho (só da
 * visita). Vale `visible(id) = global ? !fechados.has(id) : abertos.has(id)`.
 */
export function useEmbeddedChildren({ parentId, body, useLinkTable }: Options): EmbeddedChildrenState {
  const { links, zettels, controller } = useZettelStore();
  // `zettels` do store pode estar filtrado pela busca da sidebar (`search()` o
  // substitui); os filhos precisam ser resolvidos contra a lista completa.
  const [allZettels, setAllZettels] = useState<Zettel[] | null>(null);
  const [globalOn, setGlobalOn] = useState(false);
  const [opened, setOpened] = useState<ReadonlySet<string>>(() => new Set());
  const [closed, setClosed] = useState<ReadonlySet<string>>(() => new Set());

  // Lido só depois da montagem para não divergir do HTML do servidor.
  useEffect(() => {
    try {
      setGlobalOn(localStorage.getItem(STORAGE_KEY) === '1');
    } catch {
      /* localStorage indisponível: fica no padrão (desligado) */
    }
  }, []);

  const hasWikiLinks = body.includes('[[');
  useEffect(() => {
    if (!controller || !hasWikiLinks) return;
    let cancelled = false;
    controller.getAll().then((all) => {
      if (!cancelled) setAllZettels(all);
    });
    return () => {
      cancelled = true;
    };
    // `zettels` muda a cada `loadAll` (incluindo após salvar um filho).
  }, [controller, hasWikiLinks, zettels]);

  // Estado por filho vale só durante a visita a este zettel.
  useEffect(() => {
    setOpened(new Set());
    setClosed(new Set());
  }, [parentId]);

  const children = useMemo(
    () => selectEmbeddableChildren(parentId, body, useLinkTable ? links : null, allZettels ?? zettels),
    [parentId, body, useLinkTable, links, allZettels, zettels],
  );

  const byTitle = useMemo(() => {
    const map = new Map<string, Zettel>();
    for (const c of children) map.set(c.title.trim().toLowerCase(), c);
    return map;
  }, [children]);

  const childForTitle = useCallback(
    (title: string) => byTitle.get(title.trim().toLowerCase()),
    [byTitle],
  );

  const toggleGlobal = useCallback(() => {
    setGlobalOn((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(STORAGE_KEY, next ? '1' : '0');
      } catch {
        /* sem persistência, o toggle vale só nesta sessão */
      }
      return next;
    });
    // Trocar o modo global recomeça do zero, senão sobras de `opened`/`closed`
    // do modo anterior invertem o que o usuário acabou de pedir.
    setOpened(new Set());
    setClosed(new Set());
  }, []);

  const isOpen = useCallback(
    (id: string) => (globalOn ? !closed.has(id) : opened.has(id)),
    [globalOn, opened, closed],
  );

  const toggleChild = useCallback(
    (id: string) => {
      const flip = (prev: ReadonlySet<string>) => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      };
      if (globalOn) setClosed(flip);
      else setOpened(flip);
    },
    [globalOn],
  );

  return {
    children,
    hasChildren: children.length > 0,
    globalOn,
    toggleGlobal,
    isOpen,
    toggleChild,
    childForTitle,
  };
}
