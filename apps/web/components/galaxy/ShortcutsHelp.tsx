'use client';

import { SHORTCUTS, SHORTCUT_SCOPES } from '../../lib/galaxy/shortcuts';

/** Lista de atalhos, gerada do registro único (`lib/galaxy/shortcuts.ts`). */
export function ShortcutsHelp() {
  return (
    <div className="grid gap-x-8 gap-y-6 px-5 py-4 sm:grid-cols-2">
      {SHORTCUT_SCOPES.map((scope) => {
        const items = SHORTCUTS.filter((s) => s.scope === scope);
        if (items.length === 0) return null;
        return (
          <section key={scope}>
            <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-[#8b93a3]">{scope}</h3>
            <ul className="flex flex-col gap-1.5">
              {items.map((s) => (
                <li key={s.id} className="flex items-baseline justify-between gap-4 text-sm">
                  <span className="text-[#c9cfdb]">{s.label}</span>
                  <kbd className="shrink-0 rounded border border-white/15 bg-white/5 px-1.5 py-0.5 text-[11px] text-[#e6e9f0]">
                    {s.keys}
                  </kbd>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
