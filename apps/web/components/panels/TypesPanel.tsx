'use client';

import { useMemo, useState } from 'react';
import {
  MAX_LEVELS,
  MAX_PROTECTED_SECTIONS,
  MAX_TYPES,
  TYPE_COLORS,
  TYPE_ICONS,
  slugify,
  type TypeLevel,
  type ZettelType,
} from '@zettelkasten/core';
import { useTypesStore } from '../../store/useTypesStore';
import { removeType, saveType, type TypeDraft } from '../../lib/typeSync';

/**
 * Cadastro de tipos de zettel — modal do ZK//OS e da galáxia. O tipo define o
 * template, as seções que só o usuário escreve e a escada de maturidade. Só o
 * usuário cria e edita tipos: o agente (MCP) apenas os lê e os atribui.
 */

interface DraftLevel extends TypeLevel {
  /** Nível criado nesta edição: a chave ainda pode nascer do rótulo. */
  fresh?: boolean;
}

interface Draft extends Omit<TypeDraft, 'levels'> {
  levels: DraftLevel[];
}

const EMPTY: Draft = {
  name: '',
  icon: TYPE_ICONS[0],
  color: TYPE_COLORS[0],
  template: '',
  protectedSections: [],
  levels: [],
  countsProgress: false,
};

function toDraft(t: ZettelType): Draft {
  return {
    id: t.id,
    name: t.name,
    icon: t.icon,
    color: t.color,
    template: t.template,
    protectedSections: [...t.protectedSections],
    levels: t.levels.map((l) => ({ ...l })),
    countsProgress: t.countsProgress,
  };
}

/** Chave do nível a partir do rótulo, única entre as já usadas. */
function levelKey(label: string, used: Set<string>): string {
  const base = slugify(label) || 'nivel';
  if (!used.has(base)) return base;
  for (let n = 2; n < 100; n++) {
    const k = `${base.slice(0, 36)}-${n}`;
    if (!used.has(k)) return k;
  }
  return `${base}-${Date.now() % 1000}`;
}

const field =
  'w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-brand';
const smallBtn =
  'rounded-lg px-2.5 py-1.5 text-xs text-zinc-300 hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40';

export function TypesPanel({ embedded = false }: { embedded?: boolean }) {
  const types = useTypesStore((s) => s.types);
  const assignments = useTypesStore((s) => s.assignments);
  const rejected = useTypesStore((s) => s.rejected);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [removingLevel, setRemovingLevel] = useState<number | null>(null);
  const [sectionInput, setSectionInput] = useState('');

  const usage = useMemo(() => {
    const byType = new Map<string, number>();
    const byLevel = new Map<string, number>();
    for (const a of assignments.values()) {
      byType.set(a.typeId, (byType.get(a.typeId) ?? 0) + 1);
      if (a.level) byLevel.set(`${a.typeId}\u0000${a.level}`, (byLevel.get(`${a.typeId}\u0000${a.level}`) ?? 0) + 1);
    }
    return { byType, byLevel };
  }, [assignments]);

  const patch = (p: Partial<Draft>) => setDraft((d) => (d ? { ...d, ...p } : d));
  const patchLevel = (i: number, p: Partial<DraftLevel>) =>
    setDraft((d) => (d ? { ...d, levels: d.levels.map((l, j) => (j === i ? { ...l, ...p } : l)) } : d));

  const startNew = () => {
    setErrors([]);
    setDeleting(null);
    setRemovingLevel(null);
    setSectionInput('');
    setDraft({ ...EMPTY });
  };
  const startEdit = (t: ZettelType) => {
    setErrors([]);
    setDeleting(null);
    setRemovingLevel(null);
    setSectionInput('');
    setDraft(toDraft(t));
  };
  const close = () => {
    setDraft(null);
    setErrors([]);
    setRemovingLevel(null);
  };

  const addLevel = () =>
    setDraft((d) => {
      if (!d || d.levels.length >= MAX_LEVELS) return d;
      return { ...d, levels: [...d.levels, { key: '', label: '', emoji: '', userOnly: false, fresh: true }] };
    });

  const moveLevel = (i: number, dir: -1 | 1) =>
    setDraft((d) => {
      if (!d) return d;
      const j = i + dir;
      if (j < 0 || j >= d.levels.length) return d;
      const levels = [...d.levels];
      [levels[i], levels[j]] = [levels[j], levels[i]];
      return { ...d, levels };
    });

  const dropLevel = (i: number) => {
    setRemovingLevel(null);
    setDraft((d) => (d ? { ...d, levels: d.levels.filter((_, j) => j !== i) } : d));
  };

  const askDropLevel = (i: number) => {
    if (!draft) return;
    const l = draft.levels[i];
    const used = draft.id && !l.fresh ? (usage.byLevel.get(`${draft.id}\u0000${l.key}`) ?? 0) : 0;
    if (used > 0) setRemovingLevel(i);
    else dropLevel(i);
  };

  const addSection = () => {
    const v = sectionInput.trim();
    if (!v || !draft) return;
    if (draft.protectedSections.length >= MAX_PROTECTED_SECTIONS) return;
    if (draft.protectedSections.some((s) => s.toLowerCase() === v.toLowerCase())) {
      setSectionInput('');
      return;
    }
    patch({ protectedSections: [...draft.protectedSections, v] });
    setSectionInput('');
  };

  const submit = async () => {
    if (!draft || saving) return;
    // Fecha as chaves dos níveis novos a partir do rótulo (as antigas nunca mudam).
    const used = new Set(draft.levels.filter((l) => !l.fresh).map((l) => l.key));
    const levels: TypeLevel[] = draft.levels.map((l) => {
      if (!l.fresh) return { key: l.key, label: l.label.trim(), emoji: l.emoji?.trim() || undefined, userOnly: l.userOnly };
      const key = levelKey(l.label, used);
      used.add(key);
      return { key, label: l.label.trim(), emoji: l.emoji?.trim() || undefined, userOnly: l.userOnly };
    });
    setSaving(true);
    const pending = sectionInput.trim();
    const sections = pending && !draft.protectedSections.includes(pending) ? [...draft.protectedSections, pending] : draft.protectedSections;
    const res = await saveType({ ...draft, levels, protectedSections: sections });
    setSaving(false);
    if (res.ok) close();
    else setErrors(res.errors);
  };

  const confirmDelete = async (id: string) => {
    await removeType(id);
    setDeleting(null);
    if (draft?.id === id) close();
  };

  return (
    <div className={embedded ? 'px-6 py-6' : 'mx-auto max-w-2xl px-4 pb-16 pt-6'}>
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-zinc-100">Tipos de zettel</h1>
          <p className="mt-0.5 text-xs text-zinc-400">
            {types.length} de {MAX_TYPES} tipos. O tipo define o template, as seções só suas e a escada de níveis.
          </p>
        </div>
        {!draft && (
          <button
            type="button"
            onClick={startNew}
            disabled={types.length >= MAX_TYPES}
            className="flex-none rounded-lg bg-brand px-3 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-40"
          >
            Novo tipo
          </button>
        )}
      </div>

      {rejected > 0 && (
        <p className="mb-3 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
          {rejected} {rejected === 1 ? 'item não foi aceito' : 'itens não foram aceitos'} pelo servidor e ficou só neste aparelho.
        </p>
      )}

      {!draft && types.length === 0 && (
        <p className="rounded-xl border border-dashed border-zinc-700 px-4 py-8 text-center text-sm text-zinc-400">
          Nenhum tipo ainda. Crie um para dar template, seções protegidas e níveis de maturidade aos seus zettels.
        </p>
      )}

      {!draft && (
        <ul className="space-y-2">
          {types.map((t) => {
            const n = usage.byType.get(t.id) ?? 0;
            return (
              <li key={t.id} className="rounded-xl border border-zinc-800 bg-zinc-900/60 px-4 py-3">
                <div className="flex items-center gap-3">
                  <span
                    className="flex h-9 w-9 flex-none items-center justify-center rounded-lg text-lg"
                    style={{ backgroundColor: `${t.color}26`, border: `1px solid ${t.color}` }}
                    aria-hidden
                  >
                    {t.icon}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-zinc-100">{t.name}</p>
                    <p className="truncate text-xs text-zinc-400">
                      {t.slug} · {n} {n === 1 ? 'zettel' : 'zettels'}
                      {t.levels.length > 0 && ` · ${t.levels.map((l) => l.emoji || l.label).join(' → ')}`}
                      {t.countsProgress && ' · conta no progresso'}
                    </p>
                  </div>
                  <button type="button" className={smallBtn} onClick={() => startEdit(t)}>
                    Editar
                  </button>
                  <button
                    type="button"
                    className={`${smallBtn} text-red-300`}
                    onClick={() => setDeleting(deleting === t.id ? null : t.id)}
                  >
                    Apagar
                  </button>
                </div>
                {deleting === t.id && (
                  <div className="mt-3 rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-100">
                    <p>
                      {n === 0
                        ? 'Nenhum zettel usa este tipo.'
                        : `${n} ${n === 1 ? 'zettel usa' : 'zettels usam'} este tipo e ${n === 1 ? 'volta' : 'voltam'} a ficar sem tipo.`}{' '}
                      Nenhum zettel é apagado.
                    </p>
                    <div className="mt-2 flex gap-2">
                      <button type="button" className="rounded-lg bg-red-500/80 px-3 py-1.5 text-white" onClick={() => void confirmDelete(t.id)}>
                        Apagar tipo
                      </button>
                      <button type="button" className={smallBtn} onClick={() => setDeleting(null)}>
                        Cancelar
                      </button>
                    </div>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {draft && (
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <label className="block">
            <span className="mb-1 block text-xs text-zinc-400">Nome</span>
            <input className={field} value={draft.name} maxLength={60} autoFocus onChange={(e) => patch({ name: e.target.value })} />
            {!draft.id && draft.name.trim() && (
              <span className="mt-1 block text-xs text-zinc-500">slug: {slugify(draft.name) || '—'} (não muda depois)</span>
            )}
          </label>

          <div>
            <span className="mb-1 block text-xs text-zinc-400">Ícone</span>
            <div className="flex flex-wrap gap-1.5">
              {TYPE_ICONS.map((ic) => (
                <button
                  key={ic}
                  type="button"
                  aria-pressed={draft.icon === ic}
                  onClick={() => patch({ icon: ic })}
                  className={`h-9 w-9 rounded-lg text-lg ${draft.icon === ic ? 'bg-white/15 ring-1 ring-brand' : 'hover:bg-white/10'}`}
                >
                  {ic}
                </button>
              ))}
            </div>
          </div>

          <div>
            <span className="mb-1 block text-xs text-zinc-400">Cor</span>
            <div className="flex flex-wrap gap-2">
              {TYPE_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  aria-label={`Cor ${c}`}
                  aria-pressed={draft.color === c}
                  onClick={() => patch({ color: c })}
                  className={`h-7 w-7 rounded-full ${draft.color === c ? 'ring-2 ring-white ring-offset-2 ring-offset-zinc-900' : ''}`}
                  style={{ backgroundColor: c }}
                />
              ))}
            </div>
          </div>

          <label className="block">
            <span className="mb-1 block text-xs text-zinc-400">Template (corpo inicial de um zettel deste tipo)</span>
            <textarea
              className={`${field} h-32 font-mono`}
              value={draft.template}
              placeholder={'## Captura\n\n## Minha síntese\n\n## Testes'}
              onChange={(e) => patch({ template: e.target.value })}
            />
          </label>

          <div>
            <span className="mb-1 block text-xs text-zinc-400">
              Seções só suas (o agente nunca as altera) · {draft.protectedSections.length}/{MAX_PROTECTED_SECTIONS}
            </span>
            <div className="mb-2 flex flex-wrap gap-1.5">
              {draft.protectedSections.map((s) => (
                <span key={s} className="flex items-center gap-1 rounded-full bg-white/10 px-2.5 py-1 text-xs text-zinc-100">
                  {s}
                  <button
                    type="button"
                    aria-label={`Remover ${s}`}
                    className="text-zinc-400 hover:text-white"
                    onClick={() => patch({ protectedSections: draft.protectedSections.filter((x) => x !== s) })}
                  >
                    ×
                  </button>
                </span>
              ))}
            </div>
            <div className="flex gap-2">
              <input
                className={field}
                value={sectionInput}
                placeholder="Minha síntese"
                onChange={(e) => setSectionInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    addSection();
                  }
                }}
              />
              <button type="button" className={smallBtn} onClick={addSection}>
                Adicionar
              </button>
            </div>
          </div>

          <div>
            <div className="mb-1 flex items-center justify-between">
              <span className="text-xs text-zinc-400">
                Níveis de maturidade, do primeiro ao último · {draft.levels.length}/{MAX_LEVELS}
              </span>
              <button type="button" className={smallBtn} onClick={addLevel} disabled={draft.levels.length >= MAX_LEVELS}>
                + Nível
              </button>
            </div>
            {draft.levels.length === 0 && <p className="text-xs text-zinc-500">Sem níveis: o zettel só tem tipo.</p>}
            <ul className="space-y-2">
              {draft.levels.map((l, i) => {
                const used = draft.id && !l.fresh ? (usage.byLevel.get(`${draft.id}\u0000${l.key}`) ?? 0) : 0;
                return (
                  <li key={l.fresh ? `n${i}` : l.key} className="rounded-lg border border-zinc-800 bg-zinc-900/60 p-2">
                    <div className="flex items-center gap-2">
                      <input
                        className={`${field} w-16 text-center`}
                        value={l.emoji ?? ''}
                        maxLength={8}
                        aria-label="Emoji do nível"
                        placeholder="🙂"
                        onChange={(e) => patchLevel(i, { emoji: e.target.value })}
                      />
                      <input
                        className={field}
                        value={l.label}
                        maxLength={40}
                        aria-label="Rótulo do nível"
                        placeholder="Semente"
                        onChange={(e) => patchLevel(i, { label: e.target.value })}
                      />
                      <button type="button" className={smallBtn} aria-label="Subir" disabled={i === 0} onClick={() => moveLevel(i, -1)}>
                        ↑
                      </button>
                      <button
                        type="button"
                        className={smallBtn}
                        aria-label="Descer"
                        disabled={i === draft.levels.length - 1}
                        onClick={() => moveLevel(i, 1)}
                      >
                        ↓
                      </button>
                      <button type="button" className={`${smallBtn} text-red-300`} aria-label="Remover nível" onClick={() => askDropLevel(i)}>
                        ×
                      </button>
                    </div>
                    <label className="mt-2 flex items-center gap-2 text-xs text-zinc-300">
                      <input
                        type="checkbox"
                        checked={l.userOnly}
                        onChange={(e) => patchLevel(i, { userOnly: e.target.checked })}
                        className="accent-[rgb(var(--color-brand))]"
                      />
                      Só eu marco este nível (o agente não pode)
                      {used > 0 && <span className="ml-auto text-zinc-500">{used} zettel(s) neste nível</span>}
                    </label>
                    {removingLevel === i && (
                      <div className="mt-2 rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-100">
                        <p>
                          {used} {used === 1 ? 'zettel está' : 'zettels estão'} neste nível e {used === 1 ? 'ficará' : 'ficarão'} sem nível
                          (continuam com o tipo).
                        </p>
                        <div className="mt-2 flex gap-2">
                          <button type="button" className="rounded-lg bg-red-500/80 px-3 py-1.5 text-white" onClick={() => dropLevel(i)}>
                            Remover nível
                          </button>
                          <button type="button" className={smallBtn} onClick={() => setRemovingLevel(null)}>
                            Cancelar
                          </button>
                        </div>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>

          <label className="flex items-center gap-2 text-sm text-zinc-200">
            <input
              type="checkbox"
              checked={draft.countsProgress}
              onChange={(e) => patch({ countsProgress: e.target.checked })}
              className="accent-[rgb(var(--color-brand))]"
            />
            Conta no progresso das trilhas
          </label>

          {errors.length > 0 && (
            <ul className="rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-100">
              {errors.map((er) => (
                <li key={er}>{er}</li>
              ))}
            </ul>
          )}

          <div className="flex gap-2">
            <button
              type="submit"
              disabled={saving}
              className="rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-40"
            >
              {saving ? 'Salvando…' : 'Salvar'}
            </button>
            <button type="button" className={`${smallBtn} px-4 py-2 text-sm`} onClick={close}>
              Cancelar
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
