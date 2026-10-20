'use client';

import dynamic from 'next/dynamic';

// A galáxia é a tela principal. Canvas e IndexedDB não existem no SSR.
const Galaxy = dynamic(() => import('../components/galaxy/Galaxy').then((m) => m.Galaxy), {
  ssr: false,
  loading: () => <div className="fixed inset-0 bg-[#05070c]" />,
});

export default function Home() {
  return <Galaxy />;
}
