'use client';

import { useMemo } from 'react';
import { buildQueue } from '@zettelkasten/core';
import { useZettelStore } from '../store/useZettelStore';
import { useReviewStore } from '../store/useReviewStore';

/**
 * Contagens da revisão para os pontos de entrada (Sidebar, header mobile,
 * Dashboard). Reaproveita `buildQueue` para que badge e sessão nunca discordem
 * sobre quantos zettels estão esperando.
 */
export function useReviewCounts() {
  const zettels = useZettelStore((s) => s.zettels);
  const states = useReviewStore((s) => s.states);
  const newPerDay = useReviewStore((s) => s.newPerDay);

  return useMemo(() => {
    const queue = buildQueue(zettels, new Map(Object.entries(states)), Date.now(), newPerDay);
    return {
      dueCount: queue.dueCount,
      newCount: queue.newCount,
      totalCount: queue.items.length,
      nextDueAt: queue.nextDueAt,
    };
  }, [zettels, states, newPerDay]);
}
