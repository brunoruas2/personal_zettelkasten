'use client';

import { useEffect, useState } from 'react';
import { mermaidThemeKey, renderMermaid } from '../lib/mermaidEngine';
import { DiagramFrame, type DiagramState } from './DiagramFrame';

// Module-level cache: SVG por (accent, source). O accent entra na chave porque
// o `initialize` do Mermaid é global e o SVG sai com a cor já aplicada.
const svgCache = new Map<string, string>();

function cacheKeyFor(source: string): string {
  return `mm:${mermaidThemeKey()}:${source}`;
}

export function MermaidBlock({ source }: { source: string }) {
  const code = source.trim();
  const [state, setState] = useState<DiagramState>(() => (svgCache.has(cacheKeyFor(code)) ? 'ok' : 'loading'));
  const [svg, setSvg] = useState<string>(() => svgCache.get(cacheKeyFor(code)) ?? '');

  useEffect(() => {
    const themeKey = mermaidThemeKey();
    const key = `mm:${themeKey}:${code}`;
    const hit = svgCache.get(key);
    if (hit !== undefined) {
      setSvg(hit);
      setState('ok');
      return;
    }

    let cancelled = false;
    setState('loading');
    renderMermaid(code, themeKey)
      .then((svgText) => {
        if (cancelled) return;
        svgCache.set(key, svgText);
        setSvg(svgText);
        setState('ok');
      })
      .catch(() => {
        if (!cancelled) setState('error');
      });

    return () => {
      cancelled = true;
    };
  }, [code]);

  return <DiagramFrame state={state} svg={svg} source={source} />;
}
