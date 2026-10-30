'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import type { ZettelMeta } from '@zettelkasten/core';
import { useZettelStore } from '../../store/useZettelStore';
import { searchZettels } from '../../lib/searchZettels';
import { getRecentIds } from '../../lib/recentZettels';
import { useZettelBody } from '../../hooks/useZettelBody';
import { MarkdownRenderer } from '../MarkdownRenderer';
import { TagChip } from './TagChip';
import type { RelatedItem } from '../../lib/galaxy/related';

const DEBOUNCE_MS = 200;
const PREVIEW_DEBOUNCE_MS = 150;
const RECENT_LIMIT = 60;

export interface SearchFilters {
  tags?: string[];
  unplacedOnly?: boolean;
}

type Sort = 'relevance' | 'recent';

/**
 * Busca da galáxia, em modal. Mesma cadeia de busca do app (`searchZettels`);
 * filtros e ordenação são aplicados no cliente sobre o resultado. A prévia
 * carrega o corpo de um zettel por vez, com espera na troca de seleção — segurar
 * ↓ não carrega um corpo por tecla.
 */
export function GalaxySearch({
  initial,
  canFly,
  isUnplaced,
  onClose,
  onFly,
  onOpen,
  onFocus,
  onTag,
  relatedOf,
}: {
  initial: SearchFilters;
  canFly: (id: string) => boolean;
  isUnplaced: (id: string) => boolean;
  onClose: () => void;
  onFly: (id: string) => void;
  onOpen: (id: string) => void;
  /** Tag da prévia: fecha a busca e liga o filtro de tag da galáxia. */
  onTag?: (tag: string) => void;
  /** Relacionados do zettel da prévia (tags, 2º grau, proximidade). */
  relatedOf?: (id: string) => RelatedItem[];
  /** Ctrl+Enter: modo foco no resultado. */
  onFocus: (id: string) => void;
}) {
  const zettels = useZettelStore((s) => s.zettels);
  const links = useZettelStore((s) => s.links);
  const controller = useZettelStore((s) => s.controller);
  const excludedTags = useZettelStore((s) => s.graphExcludedTags);

  const [query, setQuery] = useState('');
  const [found, setFound] = useState<ZettelMeta[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [tags, setTags] = useState<string[]>(initial.tags ?? []);
  const [orphansOnly, setOrphansOnly] = useState(false);
  const [inboxOnly, setInboxOnly] = useState(false);
  const [unplacedOnly, setUnplacedOnly] = useState(initial.unplacedOnly ?? false);
  const [includeHidden, setIncludeHidden] = useState(false);
  const [sort, setSort] = useState<Sort>('relevance');
  const [tagMenu, setTagMenu] = useState(false);
  const [selected, setSelected] = useState(0);
  const [previewId, setPreviewId] = useState<string | null>(null);
  // Já debounced pela troca de `previewId`; recalcula se o índice ou os links mudam.
  const related = useMemo(
    () => (previewId && relatedOf ? relatedOf(previewId) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [previewId, relatedOf, zettels, links],
  );

  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const genRef = useRef(0);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Vizinhos (sem direção) por id — conexões, "avulso" e "Mora perto de".
  const neighbors = useMemo(() => {
    const m = new Map<string, Set<string>>();
    const add = (a: string, b: string) => {
      let s = m.get(a);
      if (!s) m.set(a, (s = new Set()));
      s.add(b);
    };
    for (const l of links) {
      if (l.sourceId === l.targetId) continue;
      add(l.sourceId, l.targetId);
      add(l.targetId, l.sourceId);
    }
    return m;
  }, [links]);

  const byId = useMemo(() => new Map(zettels.map((z) => [z.id, z])), [zettels]);

  const allTags = useMemo(() => {
    const counts = new Map<string, number>();
    for (const z of zettels) for (const t of z.tags) counts.set(t, (counts.get(t) ?? 0) + 1);
    return [...counts.entries()].sort((a, b) => b[1] - a[1]);
  }, [zettels]);

  const recents = useMemo(() => {
    const out: ZettelMeta[] = [];
    const seen = new Set<string>();
    for (const id of getRecentIds()) {
      const z = byId.get(id);
      if (z && !seen.has(id)) {
        out.push(z);
        seen.add(id);
      }
    }
    const rest = zettels.filter((z) => !seen.has(z.id)).sort((a, b) => b.updatedAt - a.updatedAt);
    return [...out, ...rest].slice(0, RECENT_LIMIT);
  }, [zettels, byId]);

  // Busca com debounce; resposta fora de ordem é descartada pelo contador.
  useEffect(() => {
    const q = query.trim();
    if (!q) {
      genRef.current++;
      setFound(null);
      setLoading(false);
      return;
    }
    if (!controller) return;
    const gen = ++genRef.current;
    setLoading(true);
    const t = setTimeout(async () => {
      try {
        const res = await searchZettels(controller, q);
        if (genRef.current === gen) setFound(res);
      } catch {
        if (genRef.current === gen) setFound([]);
      } finally {
        if (genRef.current === gen) setLoading(false);
      }
    }, DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [query, controller]);

  const excluded = useMemo(() => new Set(excludedTags), [excludedTags]);
  const isHidden = (z: ZettelMeta) => z.tags.some((t) => excluded.has(t));

  const results = useMemo(() => {
    // Sem filtro de texto mas com filtro de tag/avulso/sem lugar: parte da base
    // inteira, não só dos recentes.
    const filtering = tags.length > 0 || orphansOnly || unplacedOnly || inboxOnly;
    let list = found ?? (filtering ? zettels : recents);
    list = list.filter((z) => {
      if (!includeHidden && isHidden(z)) return false;
      if (tags.length && !tags.every((t) => z.tags.includes(t))) return false;
      if (inboxOnly && !z.tags.includes('inbox')) return false;
      if (orphansOnly && (neighbors.get(z.id)?.size ?? 0) > 0) return false;
      if (unplacedOnly && !isUnplaced(z.id)) return false;
      return true;
    });
    if (sort === 'recent' || (!found && filtering)) list = [...list].sort((a, b) => b.updatedAt - a.updatedAt);
    return list;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [found, zettels, recents, tags, orphansOnly, inboxOnly, unplacedOnly, includeHidden, sort, neighbors, excluded]);

  useEffect(() => setSelected(0), [results]);

  const current = results[selected];

  useEffect(() => {
    const id = current?.id ?? null;
    const t = setTimeout(() => setPreviewId(id), PREVIEW_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [current?.id]);

  useEffect(() => {
    listRef.current?.querySelector(`[data-index="${selected}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [selected]);

  const act = (z: ZettelMeta | undefined) => {
    if (!z) return;
    if (canFly(z.id)) onFly(z.id);
    else onOpen(z.id);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (results.length === 0) return;
      setSelected((i) => Math.min(results.length - 1, Math.max(0, i + (e.key === 'ArrowDown' ? 1 : -1))));
    } else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      if (current) onFocus(current.id);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      act(current);
    }
  };

  const chip = (on: boolean) =>
    `rounded-lg border px-2.5 py-1 text-xs transition-colors ${
      on ? 'border-brand/60 bg-brand/20 text-[#e6e9f0]' : 'border-white/10 text-[#8b93a3] hover:bg-white/5'
    }`;

  return (
    <div className="flex h-full min-h-0 flex-col lg:h-[75vh]" onKeyDown={onKeyDown}>
      <div className="flex shrink-0 items-center gap-3 border-b border-white/10 px-5 py-3">
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="shrink-0 text-[#6f7787]"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Buscar"
          className="min-w-0 flex-1 bg-transparent text-base text-[#e6e9f0] outline-none placeholder:text-[#6f7787]"
        />
        <span className="shrink-0 text-xs text-[#6f7787]">
          {loading ? 'buscando…' : `${results.length} resultado${results.length === 1 ? '' : 's'}`}
        </span>
      </div>

      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-white/10 px-5 py-2.5">
        {tags.map((t) => (
          <button key={t} type="button" className={chip(true)} onClick={() => setTags((v) => v.filter((x) => x !== t))}>
            #{t} ×
          </button>
        ))}
        <div className="relative">
          <button type="button" className={chip(false)} onClick={() => setTagMenu((v) => !v)}>
            Tags ▾
          </button>
          {tagMenu && (
            <div className="absolute left-0 top-full z-10 mt-1 max-h-64 w-56 overflow-y-auto rounded-lg border border-white/10 bg-[#0e121a] p-1 shadow-2xl">
              {allTags.map(([t, n]) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => {
                    setTags((v) => (v.includes(t) ? v.filter((x) => x !== t) : [...v, t]));
                    setTagMenu(false);
                  }}
                  className="flex w-full items-center justify-between rounded px-2 py-1 text-left text-xs text-[#c9cfdb] hover:bg-white/5"
                >
                  <span>{tags.includes(t) ? '✓ ' : ''}#{t}</span>
                  <span className="text-[#6f7787]">{n}</span>
                </button>
              ))}
              {allTags.length === 0 && <p className="px-2 py-1 text-xs text-[#6f7787]">Nenhuma tag.</p>}
            </div>
          )}
        </div>
        <button type="button" className={chip(orphansOnly)} onClick={() => setOrphansOnly((v) => !v)}>
          Avulsos
        </button>
        <button type="button" className={chip(inboxOnly)} onClick={() => setInboxOnly((v) => !v)}>
          Inbox
        </button>
        {unplacedOnly && (
          <button type="button" className={chip(true)} onClick={() => setUnplacedOnly(false)}>
            Sem lugar ×
          </button>
        )}
        <button type="button" className={chip(includeHidden)} onClick={() => setIncludeHidden((v) => !v)}>
          Incluir ocultos
        </button>
        <button
          type="button"
          className={`${chip(false)} ml-auto`}
          onClick={() => setSort((s) => (s === 'relevance' ? 'recent' : 'relevance'))}
        >
          {sort === 'relevance' ? 'Relevância' : 'Recentes primeiro'} ▾
        </button>
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[22rem_minmax(0,1fr)]">
        <div ref={listRef} className="min-h-0 overflow-y-auto overscroll-contain border-white/10 lg:border-r">
          {results.length === 0 ? (
            <p className="px-5 py-10 text-center text-sm text-[#6f7787]">{loading ? 'Buscando…' : 'Nenhum resultado.'}</p>
          ) : (
            results.map((z, idx) => {
              const degree = neighbors.get(z.id)?.size ?? 0;
              const hidden = isHidden(z);
              const unplaced = !hidden && isUnplaced(z.id);
              return (
                <button
                  key={z.id}
                  type="button"
                  data-index={idx}
                  onMouseEnter={() => setSelected(idx)}
                  onClick={() => act(z)}
                  className={`block w-full border-l-2 px-5 py-2.5 text-left ${
                    idx === selected ? 'border-brand bg-brand/10' : 'border-transparent hover:bg-white/5'
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <span className="truncate font-newsreader text-[15px] text-[#e6e9f0]">{z.title || 'Sem título'}</span>
                    {degree === 0 && <Badge>avulso</Badge>}
                    {unplaced && <Badge tone="amber">sem lugar</Badge>}
                    {hidden && <Badge>oculto</Badge>}
                  </div>
                  <div className="mt-0.5 truncate text-xs text-[#6f7787]">
                    {z.tags.length ? z.tags.map((t) => `#${t}`).join(' ') : 'sem tags'}
                    {degree > 0 && ` · ${degree} ${degree === 1 ? 'conexão' : 'conexões'}`}
                  </div>
                </button>
              );
            })
          )}
        </div>
        <div className="hidden min-h-0 min-w-0 lg:block">
          {previewId && byId.get(previewId) ? (
            <Preview
              meta={byId.get(previewId)!}
              near={[...(neighbors.get(previewId) ?? [])].map((id) => byId.get(id)?.title).filter((t): t is string => !!t)}
              canFly={canFly(previewId)}
              onFly={() => onFly(previewId)}
              onOpen={() => onOpen(previewId)}
              onTag={onTag}
              related={related}
              onRelated={(id) => (canFly(id) ? onFly(id) : onOpen(id))}
            />
          ) : (
            <p className="px-6 py-10 text-center text-sm text-[#6f7787]">Nenhum zettel selecionado.</p>
          )}
        </div>
      </div>

      <div className="hidden shrink-0 items-center gap-4 border-t border-white/10 px-5 py-2 text-xs text-[#6f7787] lg:flex">
        <span>↑↓ navegar</span>
        <span>↵ voar até</span>
        <span>Ctrl ↵ focar</span>
        <span>Esc voltar à galáxia</span>
        <button type="button" onClick={onClose} className="ml-auto hover:text-[#c9cfdb]">Fechar</button>
      </div>
    </div>
  );
}

function Badge({ children, tone }: { children: React.ReactNode; tone?: 'amber' }) {
  return (
    <span
      className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] ${
        tone === 'amber' ? 'bg-amber-300/10 text-amber-200' : 'bg-white/5 text-[#8b93a3]'
      }`}
    >
      {children}
    </span>
  );
}

function Preview({
  meta,
  near,
  canFly,
  onFly,
  onOpen,
  onTag,
  related,
  onRelated,
}: {
  meta: ZettelMeta;
  near: string[];
  canFly: boolean;
  onFly: () => void;
  onOpen: () => void;
  onTag?: (tag: string) => void;
  related: RelatedItem[];
  onRelated?: (id: string) => void;
}) {
  const { body, status } = useZettelBody(meta.id);
  const nearText =
    near.length === 0 ? null : near.length <= 3 ? joinPt(near) : `${joinPt(near.slice(0, 3))} e mais ${near.length - 3}`;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center justify-between px-6 pt-4 text-xs uppercase tracking-wide text-[#6f7787]">
        Prévia
        <div className="flex gap-2 normal-case tracking-normal">
          <button type="button" onClick={onOpen} className="rounded-lg border border-white/10 px-3 py-1 text-[#c9cfdb] hover:bg-white/5">
            Abrir
          </button>
          {canFly && (
            <button type="button" onClick={onFly} className="rounded-lg bg-brand px-3 py-1 font-medium text-white hover:opacity-90">
              Voar até ↵
            </button>
          )}
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4">
        <h3 className="font-newsreader text-2xl font-medium text-[#f5f3ff]">{meta.title || 'Sem título'}</h3>
        {meta.tags.length > 0 && (
          <div className="mt-1 flex flex-wrap gap-1.5 text-xs text-brand-light">
            {meta.tags.map((t) => (
              <TagChip key={t} tag={t} label={`#${t}`} onTag={onTag} className="rounded-md px-1 py-0.5" />
            ))}
          </div>
        )}
        <div className="mt-4 text-sm">
          {status === 'loading' ? (
            <p className="text-[#6f7787]">Carregando…</p>
          ) : status === 'missing' ? (
            <p className="text-[#6f7787]">Conteúdo ainda não disponível neste aparelho.</p>
          ) : body.trim() ? (
            <MarkdownRenderer body={body} onLinkPress={() => {}} disableWikiLinks disableHeavyBlocks />
          ) : (
            <p className="italic text-[#6f7787]">Sem conteúdo.</p>
          )}
        </div>
        {related.length > 0 && (
          <div className="mt-6 border-t border-white/10 pt-3">
            <div className="text-xs uppercase tracking-wide text-[#6f7787]">Relacionados</div>
            <ul className="mt-2 flex flex-col gap-1">
              {related.map((r) => (
                <li key={r.id}>
                  <button
                    type="button"
                    onClick={() => onRelated?.(r.id)}
                    className="flex w-full items-baseline justify-between gap-3 rounded-lg px-2 py-1.5 text-left hover:bg-white/5"
                  >
                    <span className="min-w-0 truncate font-newsreader text-[15px] text-[#e6e9f0]">{r.title || 'Sem título'}</span>
                    <span className="shrink-0 text-[11px] text-[#8b93a3]">{r.reason}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
        {nearText && <p className="mt-6 border-t border-white/10 pt-3 text-xs text-[#8b93a3]">Mora perto de {nearText}</p>}
      </div>
    </div>
  );
}

function joinPt(items: string[]): string {
  if (items.length <= 1) return items.join('');
  return `${items.slice(0, -1).join(', ')} e ${items[items.length - 1]}`;
}
