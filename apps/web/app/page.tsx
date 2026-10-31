'use client';

import dynamic from 'next/dynamic';
import { useEffect, useState } from 'react';

// Canvas e IndexedDB não existem no SSR.
const Galaxy = dynamic(() => import('../components/galaxy/Galaxy').then((m) => m.Galaxy), {
  ssr: false,
  loading: () => <div className="fixed inset-0 bg-[#05070c]" />,
});
const Levels = dynamic(() => import('../components/levels/Levels').then((m) => m.Levels), {
  ssr: false,
  loading: () => <div className="fixed inset-0 bg-[#05070d]" />,
});

const UI_KEY = 'zettel_ui';
type Ui = 'zkos' | 'galaxy';

/**
 * Qual interface abrir: o fluxo Foco → Memória → Mapa (`zkos`) ou a galáxia.
 * A escolha é por dispositivo (`zettel_ui`) e pode ser trocada abrindo
 * `/?ui=zkos` ou `/?ui=galaxy`. O fluxo novo é o padrão; a galáxia só abre
 * por escolha explícita (`?ui=galaxy`, change zkos-default-ui).
 */
function readUi(): Ui {
  try {
    const q = new URLSearchParams(window.location.search).get('ui');
    if (q === 'zkos' || q === 'galaxy') {
      localStorage.setItem(UI_KEY, q);
      return q;
    }
    return localStorage.getItem(UI_KEY) === 'galaxy' ? 'galaxy' : 'zkos';
  } catch {
    return 'zkos';
  }
}

export default function Home() {
  const [ui, setUi] = useState<Ui | null>(null);
  useEffect(() => setUi(readUi()), []);
  if (ui === null) return <div className="fixed inset-0 bg-[#05070c]" />;
  return ui === 'zkos' ? <Levels /> : <Galaxy />;
}
