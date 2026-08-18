'use client';

import { useEffect, useRef, useState } from 'react';

interface Props {
  source: string;
}

export function AbcNotation({ source }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!containerRef.current) return;
    const el = containerRef.current;

    setReady(false);
    import('abcjs').then((abcjs) => {
      abcjs.renderAbc(el, source, {
        responsive: 'resize',
        foregroundColor: 'currentColor',
        paddingright: 0,
        paddingleft: 0,
      });
      setReady(true);
    });
  }, [source]);

  return (
    <div data-render-state={ready ? 'ok' : 'loading'} className="my-3 overflow-hidden rounded-lg border border-zinc-200 bg-white dark:border-zinc-700 dark:bg-zinc-950">
      <div className="border-b border-zinc-200 px-3 py-1.5 dark:border-zinc-700">
        <span className="text-xs text-zinc-400">partitura</span>
      </div>
      <div
        ref={containerRef}
        className="overflow-x-auto px-3 py-2 text-zinc-900 dark:text-zinc-100 [&_svg]:max-w-full"
      />
    </div>
  );
}
