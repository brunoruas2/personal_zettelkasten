'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import type { ZettelMeta } from '@zettelkasten/core';
import { useZettelStore } from '../../store/useZettelStore';
import { searchZettels } from '../../lib/searchZettels';
import { getRecentIds } from '../../lib/recentZettels';

const DEBOUNCE_MS = 200;
const MAX_ZETTELS = 8;
const MAX_TAGS = 5;
const MAX_RECENTS = 6;

export interface PaletteAction {
  id: string;
  label: string;
  /** Atalho exibido ao lado (do registro de atalhos). */
  keys?: string;
  run: () => void;
}

type Item =
  | { kind: 'action'; key: string; label: string; hint?: string; run: () => void }
  | { kind: 'zettel'; key: string; label: string; hint: string; id: string }
  | { kind: 'tag'; key: string; label: string; hint: string; tag: string };

const norm = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

/**
 * Paleta de comandos (`Ctrl/⌘+K`): uma entrada para ações, zettels e tags.
 * Zettels vêm da mesma cadeia da busca da galáxia (`searchZettels`, debounce
 * de 200 ms, contador de geração). O pai fecha a paleta e executa o item.
 */
export function CommandPalette({
  actions,
  onClose,
  onZettel,
  onZettelFocus,
  onTag,
}: {
  /** Só as ações disponíveis agora (as indisponíveis nem entram). */
  actions: PaletteAction[];
  onClose: () => void;
  /** Enter num zettel: voar (ou abrir, se não tem lugar). */
  onZettel: (id: string) => void;
  /** Ctrl+Enter num zettel: modo foco. */
  onZettelFocus: (id: string) => void;
  onTag: (tag: string) => void;
}) {
  const zettels = useZettelStore((s) => s.zettels);
  const controller = useZettelStore((s) => s.controller);
  const [query, setQuery] = useState('');
  const [found, setFound] = useState<ZettelMeta[]>([]);
  const [selected, setSelected] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const genRef = useRef(0);

  const byId = useMemo(() => new Map(zettels.map((z) => [z.id, z])), [zettels]);
  const tagCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const z of zettels) for (const t of z.tags) m.set(t, (m.get(t) ?? 0) + 1);
    return m;
  }, [zettels]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Busca de zettels com debounce; resposta de geração antiga é descartada.
  useEffect(() => {
    const q = query.trim();
    if (!q || !controller) {
      setFound([]);
      return;
    }
    const gen = ++genRef.current;
    const t = setTimeout(() => {
      void searchZettels(controller, q)
        .then((list) => {
          if (gen === genRef.current) setFound(list.slice(0, MAX_ZETTELS));
        })
        .catch(() => {
          if (gen === genRef.current) setFound([]);
        });
    }, DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [query, controller]);

  const items = useMemo<Item[]>(() => {
    const q = norm(query.trim());
    const out: Item[] = [];
    for (const a of actions) {
      if (!q || norm(a.label).includes(q)) {
        out.push({ kind: 'action', key: `a-${a.id}`, label: a.label, hint: a.keys, run: a.run });
      }
    }
    const zettelHint = (z: ZettelMeta) => (z.tags.length ? z.tags.map((t) => `#${t}`).join(' ') : 'sem tags');
    if (!q) {
      for (const id of getRecentIds().slice(0, MAX_RECENTS)) {
        const z = byId.get(id);
        if (z) out.push({ kind: 'zettel', key: `z-${z.id}`, label: z.title || 'Sem título', hint: zettelHint(z), id: z.id });
      }
    } else {
      for (const z of found) {
        out.push({ kind: 'zettel', key: `z-${z.id}`, label: z.title || 'Sem título', hint: zettelHint(z), id: z.id });
      }
      let n = 0;
      for (const [tag, count] of [...tagCounts.entries()].sort((a, b) => b[1] - a[1])) {
        if (n >= MAX_TAGS) break;
        if (!norm(tag).includes(q)) continue;
        out.push({ kind: 'tag', key: `t-${tag}`, label: `#${tag}`, hint: `${count} zettel${count === 1 ? '' : 's'}`, tag });
        n++;
      }
    }
    return out;
  }, [query, actions, found, byId, tagCounts]);

  useEffect(() => setSelected(0), [query]);
  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>('[data-selected="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [selected, items]);

  const run = (item: Item, ctrl = false) => {
    onClose();
    if (item.kind === 'action') item.run();
    else if (item.kind === 'zettel') (ctrl ? onZettelFocus : onZettel)(item.id);
    else onTag(item.tag);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelected((s) => Math.min(items.length - 1, s + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelected((s) => Math.max(0, s - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const item = items[selected];
      if (item) run(item, e.ctrlKey || e.metaKey);
    }
  };

  const sections: { title: string; kind: Item['kind'] }[] = [
    { title: 'Ações', kind: 'action' },
    { title: query.trim() ? 'Zettels' : 'Recentes', kind: 'zettel' },
    { title: 'Tags', kind: 'tag' },
  ];

  return (
    <div onKeyDown={onKeyDown} className="flex min-h-0 flex-col">
      <input
        ref={inputRef}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Digite um comando ou busque um zettel…"
        aria-label="Comando ou busca"
        className="w-full shrink-0 border-b border-white/10 bg-transparent px-5 py-3 text-[15px] text-[#e6e9f0] outline-none placeholder:text-[#8b93a3]"
      />
      <div ref={listRef} role="listbox" className="max-h-[60vh] overflow-y-auto overscroll-contain px-2 py-2">
        {items.length === 0 ? (
          <p className="px-3 py-6 text-center text-sm text-[#8b93a3]">Nada encontrado.</p>
        ) : (
          sections.map(({ title, kind }) => {
            const list = items.filter((i) => i.kind === kind);
            if (list.length === 0) return null;
            return (
              <div key={kind} className="pb-1">
                <div className="px-3 pb-1 pt-2 text-[11px] font-medium uppercase tracking-wide text-[#8b93a3]">{title}</div>
                {list.map((item) => {
                  const idx = items.indexOf(item);
                  const active = idx === selected;
                  return (
                    <button
                      key={item.key}
                      type="button"
                      role="option"
                      aria-selected={active}
                      data-selected={active}
                      onMouseMove={() => setSelected(idx)}
                      onClick={(e) => run(item, e.ctrlKey || e.metaKey)}
                      className={`flex w-full items-baseline justify-between gap-4 rounded-lg px-3 py-2 text-left ${
                        active ? 'bg-brand/20' : 'hover:bg-white/5'
                      }`}
                    >
                      <span className={`min-w-0 truncate ${item.kind === 'zettel' ? 'font-newsreader text-[15px]' : 'text-sm'} text-[#e6e9f0]`}>
                        {item.label}
                      </span>
                      {item.hint && <span className="shrink-0 text-[11px] text-[#9aa3b2]">{item.hint}</span>}
                    </button>
                  );
                })}
              </div>
            );
          })
        )}
      </div>
      <div className="hidden shrink-0 items-center gap-4 border-t border-white/10 px-5 py-2 text-xs text-[#9aa3b2] lg:flex">
        <span>↑↓ navegar</span>
        <span>↵ executar</span>
        <span>Ctrl ↵ focar no zettel</span>
        <span>Esc fechar</span>
      </div>
    </div>
  );
}
