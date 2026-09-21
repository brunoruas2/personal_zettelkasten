'use client';

import { useEffect, useState } from 'react';
import { renderPlantUml } from '../lib/plantumlEngine';
import { DiagramFrame, type DiagramState } from './DiagramFrame';

// Module-level cache: avoids re-rendering diagramas já vistos na sessão
const svgCache = new Map<string, string>();

export function PlantUmlBlock({ source }: { source: string }) {
  const cached = svgCache.get(source);
  const [state, setState] = useState<DiagramState>(cached ? 'ok' : 'loading');
  const [svg, setSvg] = useState<string>(cached ?? '');

  useEffect(() => {
    if (svgCache.has(source)) {
      setSvg(svgCache.get(source)!);
      setState('ok');
      return;
    }

    let cancelled = false;
    setState('loading');
    renderPlantUml(source)
      .then((svgText) => {
        if (cancelled) return;
        svgCache.set(source, svgText);
        setSvg(svgText);
        setState('ok');
      })
      .catch(() => {
        if (!cancelled) setState('error');
      });

    return () => {
      cancelled = true;
    };
  }, [source]);

  return <DiagramFrame state={state} svg={svg} source={source} />;
}
