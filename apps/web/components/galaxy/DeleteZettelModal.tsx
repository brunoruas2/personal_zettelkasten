'use client';

import { useEffect, useState } from 'react';
import type { CitingZettel, ZettelMeta } from '@zettelkasten/core';
import { useZettelStore } from '../../store/useZettelStore';
import { getBodyProgress } from '../../lib/bodySync';
import { useThemeVariant } from './themeVariant';

/**
 * Confirmação de exclusão: lista quem cita o título (varredura local por
 * cursor) e avisa que esses links ficam quebrados.
 */
export function DeleteZettelModal({
  meta,
  onCancel,
  onConfirm,
}: {
  meta: ZettelMeta;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const zk = useThemeVariant() === 'zkos';
  const controller = useZettelStore((s) => s.controller);
  const [citing, setCiting] = useState<CitingZettel[] | null>(null);
  const progress = getBodyProgress();
  const partial = progress.total > 0 && progress.fresh < progress.total;

  useEffect(() => {
    if (!controller) return;
    let cancelled = false;
    void controller.findCiting(meta.title, meta.id).then((c) => {
      if (!cancelled) setCiting(c);
    });
    return () => {
      cancelled = true;
    };
  }, [controller, meta.id, meta.title]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      e.stopPropagation();
      onCancel();
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [onCancel]);

  const title = meta.title || 'Sem título';
  const n = citing?.length ?? 0;

  const intro = (
    <>
      Some da galáxia e de todos os seus dispositivos.
      {citing === null
        ? ' Procurando quem cita este título…'
        : n === 0
          ? ' Nenhum zettel cita este título.'
          : ` ${n === 1 ? 'O zettel abaixo cita' : `Os ${n} zettels abaixo citam`} este título — os links viram texto quebrado.`}
      {partial && citing !== null && ' (Lista feita com o que já foi baixado neste aparelho.)'}
    </>
  );

  if (zk) {
    return (
      <div className="zk-modal-backdrop fixed inset-0 z-50 flex items-center justify-center p-4" onClick={onCancel}>
        <div
          role="dialog"
          aria-modal="true"
          aria-label={`Apagar ${title}`}
          onClick={(e) => e.stopPropagation()}
          className="dark zk-modal w-full max-w-lg"
          style={{ borderColor: 'var(--zk-magenta)' }}
        >
          <div className="zk-modal-head" style={{ background: 'var(--zk-magenta)' }}>
            <h2 className="m-0 truncate text-[inherit] font-normal">Apagar «{title}»?</h2>
          </div>
          <div className="p-5">
            <p className="m-0 text-sm text-zk-dim">{intro}</p>
            {n > 0 && (
              <ul className="mt-4 max-h-64 space-y-2 overflow-y-auto p-0" style={{ listStyle: 'none' }}>
                {citing!.map((c) => (
                  <li key={c.id} className="border border-zk-line px-3 py-2">
                    <div className="zk-display text-xl text-zk-text">{c.title || 'Sem título'}</div>
                    <div className="mt-0.5 text-xs text-zk-dim">
                      {c.before}
                      <span className="text-zk-magenta">[[{title}]]</span>
                      {c.after}
                    </div>
                  </li>
                ))}
              </ul>
            )}
            <div className="mt-6 flex justify-end gap-2">
              <button type="button" onClick={onCancel} className="zk-btn">
                CANCELAR
              </button>
              <button type="button" onClick={onConfirm} disabled={citing === null} className="zk-btn-danger">
                APAGAR ZETTEL
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#05070c]/70 p-4 font-geist" onClick={onCancel}>
      <div
        role="dialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
        className="dark w-full max-w-lg rounded-2xl border border-white/10 bg-[#0e121a] p-6 text-[#e6e9f0] shadow-2xl"
      >
        <h2 className="font-newsreader text-xl font-medium">Apagar «{title}»?</h2>
        <p className="mt-2 text-sm text-[#8b93a3]">
          Some da galáxia e de todos os seus dispositivos.
          {citing === null
            ? ' Procurando quem cita este título…'
            : n === 0
              ? ' Nenhum zettel cita este título.'
              : ` ${n === 1 ? 'O zettel abaixo cita' : `Os ${n} zettels abaixo citam`} este título — os links viram texto quebrado.`}
          {partial && citing !== null && ' (Lista feita com o que já foi baixado neste aparelho.)'}
        </p>
        {n > 0 && (
          <ul className="mt-4 max-h-64 space-y-2 overflow-y-auto">
            {citing!.map((c) => (
              <li key={c.id} className="rounded-lg border border-white/10 px-3 py-2">
                <div className="font-newsreader text-[15px] text-[#f5f3ff]">{c.title || 'Sem título'}</div>
                <div className="mt-0.5 text-xs text-[#8b93a3]">
                  {c.before}
                  <span className="rounded bg-red-400/15 px-0.5 text-red-200">[[{title}]]</span>
                  {c.after}
                </div>
              </li>
            ))}
          </ul>
        )}
        <div className="mt-6 flex justify-end gap-2">
          <button type="button" onClick={onCancel} className="rounded-lg border border-white/10 px-4 py-2 text-sm hover:bg-white/5">
            Cancelar
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={citing === null}
            className="rounded-lg bg-red-500/90 px-4 py-2 text-sm font-medium text-white hover:bg-red-500 disabled:opacity-50"
          >
            Apagar zettel
          </button>
        </div>
      </div>
    </div>
  );
}
