'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { useZettelStore } from '../../../store/useZettelStore';
import { MarkdownRenderer } from '../../../components/MarkdownRenderer';
import { OfflineLink } from '../../../components/OfflineLink';
import { TocDrawer } from '../../../components/TocDrawer';
import { useOfflineRouter } from '../../../hooks/useOfflineRouter';
import { extractHeadings } from '../../../lib/toc';
import type { Zettel } from '@zettelkasten/core';

export default function ZettelDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const offlineRouter = useOfflineRouter();
  const { controller, deleteZettel, updateZettel, graphExcludedTags } = useZettelStore();
  const [zettel, setZettel] = useState<Zettel | null>(null);
  const [backlinks, setBacklinks] = useState<Zettel[]>([]);
  const [readFontSize, setReadFontSize] = useState(16);
  const [tocOpen, setTocOpen] = useState(false);
  const contentRef = useRef<HTMLDivElement>(null);

  const hasHeadings = useMemo(
    () => extractHeadings(zettel?.body ?? '').length > 0,
    [zettel?.body],
  );

  // Lido só depois da montagem para não divergir do HTML do servidor.
  useEffect(() => {
    setTocOpen(localStorage.getItem('zettel_toc_open') === '1');
  }, []);

  const toggleToc = () => {
    setTocOpen((prev) => {
      const next = !prev;
      localStorage.setItem('zettel_toc_open', next ? '1' : '0');
      return next;
    });
  };

  useEffect(() => {
    const saved = parseInt(localStorage.getItem('zettel_read_font_size') ?? '', 10);
    if (!isNaN(saved)) setReadFontSize(saved);
  }, []);

  const adjustReadFont = (delta: number) => {
    setReadFontSize((prev) => {
      const next = Math.min(26, Math.max(12, prev + delta));
      localStorage.setItem('zettel_read_font_size', String(next));
      return next;
    });
  };

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [id]);

  useEffect(() => {
    if (!id) return;
    const key = 'zettel_recent';
    const prev: string[] = JSON.parse(localStorage.getItem(key) ?? '[]');
    const next = [id, ...prev.filter((x) => x !== id)].slice(0, 20);
    localStorage.setItem(key, JSON.stringify(next));
  }, [id]);

  useEffect(() => {
    if (!controller || !id) return;
    controller.getById(id).then(setZettel);
    controller.getBacklinks(id).then(setBacklinks);
  }, [id, controller]);

  useEffect(() => {
    if (!id) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!e.altKey || e.key !== 'e') return;
      e.preventDefault();
      offlineRouter.replace(`/zettel/${id}/edit`);
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [id, offlineRouter]);

  // Compara `e.code` (tecla física) e não `e.key`: em layouts onde Alt compõe
  // caractere — o Option do macOS — `Alt+T` chega como `†` e a comparação por
  // caractere rejeitaria o atalho. Os atalhos vizinhos ainda usam `e.key`.
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!e.altKey || e.code !== 'KeyT') return;
      // Sem heading o drawer não abre, e alternar aqui gravaria
      // `zettel_toc_open` em silêncio — o sumário apareceria aberto no próximo
      // zettel que tivesse headings.
      if (!hasHeadings) return;
      e.preventDefault();
      toggleToc();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [hasHeadings]);

  const handleLinkPress = async (title: string) => {
    if (!controller) return;
    const results = await controller.search(title);
    const exact = results.find((z) => z.title.toLowerCase() === title.toLowerCase());
    if (exact) offlineRouter.push(`/zettel/${exact.id}`);
  };

  const handleShare = () => {
    if (!zettel) return;
    const tagLine = zettel.tags.length ? `\ntags: ${zettel.tags.join(', ')}` : '';
    const content = `# ${zettel.title}${tagLine}\n\n${zettel.body}`;
    const blob = new Blob([content], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${zettel.title.replace(/[^a-z0-9]/gi, '_')}.md`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleChordsBodyChange = async (rawStart: number, rawEnd: number, newContent: string) => {
    if (!zettel) return;
    const newBody = zettel.body.slice(0, rawStart) + newContent + zettel.body.slice(rawEnd);
    setZettel((prev) => (prev ? { ...prev, body: newBody } : prev));
    await updateZettel(zettel.id, { body: newBody });
  };

  const handleDelete = async () => {
    if (!zettel) return;
    if (window.confirm('Excluir este zettel? Esta ação não pode ser desfeita.')) {
      await deleteZettel(id);
      offlineRouter.push('/');
    }
  };

  if (!zettel) {
    return (
      <div className="flex h-screen items-center justify-center">
        <p className="text-sm text-zinc-400">Carregando...</p>
      </div>
    );
  }

  return (
    <>
    {/* O recuo do drawer vive no wrapper: aplicado no mesmo elemento que tem
        `mx-auto`, ele fixaria a margem direita e só a esquerda seguiria `auto`,
        encostando a coluna no drawer em vez de centralizar. */}
    <div className={tocOpen && hasHeadings ? 'lg:pr-64' : ''}>
    <div className="mx-auto max-w-2xl px-4 pb-20 pt-4 lg:max-w-4xl lg:pt-8">
      {/* Nav */}
      <div className="mb-6 flex items-center justify-between">
        <div className="flex items-center gap-3 lg:hidden">
          <button
            onClick={() => {
              if (window.history.length > 1) {
                router.back();
              } else {
                offlineRouter.push('/');
              }
            }}
            className="text-sm text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200"
          >
            ← Voltar
          </button>
          <OfflineLink href="/" className="text-sm text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300">
            Home
          </OfflineLink>
        </div>
        <div className="hidden lg:block" />
        <div className="flex items-center gap-3">
          {hasHeadings && (
            <button
              onClick={toggleToc}
              className={tocOpen ? 'text-brand' : 'text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-300'}
              title="Sumário"
              aria-expanded={tocOpen}
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="9" y1="6" x2="21" y2="6" /><line x1="9" y1="12" x2="21" y2="12" /><line x1="9" y1="18" x2="21" y2="18" />
                <circle cx="4" cy="6" r="1" /><circle cx="4" cy="12" r="1" /><circle cx="4" cy="18" r="1" />
              </svg>
            </button>
          )}
          <button
            onClick={() => offlineRouter.replace(`/zettel/${id}/edit`)}
            className="hidden lg:block text-brand hover:opacity-80"
            title="Editar"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
              <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
            </svg>
          </button>
          <button
            onClick={() => offlineRouter.push(`/graph?focus=${id}`)}
            className="text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-300"
            title="Ver no mapa"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 21s-7-6.1-7-11a7 7 0 0 1 14 0c0 4.9-7 11-7 11z" /><circle cx="12" cy="10" r="2.5" />
            </svg>
          </button>
          <button
            onClick={() => offlineRouter.push(`/export/pdf?ids=${id}`)}
            className="text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-300"
            title="Exportar PDF"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
              <path d="M14 2v6h6" />
              <path d="M9 15h6M9 18h4" />
            </svg>
          </button>
          <button onClick={handleShare} className="text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-300" title="Exportar .md">
            <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" />
            </svg>
          </button>
          {/* Font size control */}
          <div className="flex items-center overflow-hidden rounded-xl bg-zinc-100 dark:bg-zinc-800">
            <button
              onClick={() => adjustReadFont(-1)}
              aria-label="Diminuir fonte"
              className="flex h-9 w-8 items-center justify-center text-xs font-bold text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200 active:bg-zinc-200 dark:active:bg-zinc-700"
            >
              A−
            </button>
            <button
              onClick={() => adjustReadFont(1)}
              aria-label="Aumentar fonte"
              className="flex h-9 w-8 items-center justify-center text-sm font-bold text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200 active:bg-zinc-200 dark:active:bg-zinc-700"
            >
              A+
            </button>
          </div>
          <button onClick={handleDelete} className="text-zinc-400 hover:text-red-500" title="Excluir">
            <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="3 6 5 6 21 6" /><path d="M19 6l-1 14H6L5 6" /><path d="M10 11v6" /><path d="M14 11v6" /><path d="M9 6V4h6v2" />
            </svg>
          </button>
        </div>
      </div>

      {/* Content — font size controlled by A−/A+ buttons above */}
      <div style={{ fontSize: readFontSize }}>
      <div className="mb-5 flex items-start gap-3">
        <h1 className="flex-1 text-2xl font-bold text-zinc-900 dark:text-zinc-100">{zettel.title}</h1>
      </div>

      <div ref={contentRef}>
        <MarkdownRenderer body={zettel.body} onLinkPress={handleLinkPress} onBodyChange={handleChordsBodyChange} />
      </div>

      {zettel.tags.length > 0 && (
        <div className="mt-6 flex flex-wrap gap-2">
          {zettel.tags.map((tag) => (
            <span
              key={tag}
              className="rounded-full bg-brand/10 px-3 py-1 text-xs font-medium text-brand dark:text-brand-light"
            >
              #{tag}
            </span>
          ))}
        </div>
      )}

      {backlinks.length > 0 && (
        <div className="mt-10 border-t border-zinc-200 pt-6 dark:border-zinc-800">
          <p className="mb-3 text-[10px] font-bold uppercase tracking-widest text-zinc-400">
            Referenciado por
          </p>
          {backlinks.map((b) => (
            <OfflineLink
              key={b.id}
              href={`/zettel/${b.id}`}
              className="block py-1.5 text-sm text-brand-light hover:underline"
            >
              ← {b.title}
            </OfflineLink>
          ))}
        </div>
      )}

      </div>{/* end font-size wrapper */}

      <p className="mt-10 text-[11px] text-zinc-400">
        Criado em {new Date(zettel.createdAt).toLocaleDateString('pt-BR')}
      </p>

      {zettel.tags.some((t) => graphExcludedTags.includes(t)) && (
        <p className="mt-2 text-[11px] text-zinc-400">
          Oculto do mapa de conexões —{' '}
          {zettel.tags.filter((t) => graphExcludedTags.includes(t)).map((t) => `#${t}`).join(', ')}
        </p>
      )}
    </div>
    </div>

      {/* FABs — new + edit, mobile only */}
      <div className="fixed bottom-6 right-4 z-10 flex gap-3 lg:hidden">
        <button
          onClick={() => offlineRouter.push('/zettel/new')}
          aria-label="Novo zettel"
          className="flex h-14 w-14 items-center justify-center rounded-full bg-zinc-700 text-white shadow-lg hover:opacity-90 dark:bg-zinc-600"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
          </svg>
        </button>
        <button
          onClick={() => offlineRouter.replace(`/zettel/${id}/edit`)}
          aria-label="Editar zettel"
          className="flex h-14 w-14 items-center justify-center rounded-full bg-brand text-white shadow-lg hover:opacity-90"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
            <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
          </svg>
        </button>
      </div>

      {/* scrollRef nulo: no desktop quem rola é o <main>, que é h-screen, então
          a faixa do spy medida do viewport dá o mesmo resultado. */}
      <TocDrawer open={tocOpen} onClose={toggleToc} contentRef={contentRef} revision={zettel.body} />
    </>
  );
}
