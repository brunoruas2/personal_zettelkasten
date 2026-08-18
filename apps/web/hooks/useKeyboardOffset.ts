'use client';

import { useEffect, useRef } from 'react';

/**
 * Keeps a fixed-positioned toolbar just above the software keyboard on iOS Safari,
 * and manages a spacer element so content can scroll above the keyboard.
 *
 * Returns:
 *   toolbarRef — attach to the fixed toolbar div
 *   spacerRef  — attach to an invisible div at the end of the scrollable content (lg:hidden)
 *
 * The spacer height = keyboard offset + baseBottomSpace (default 80px).
 * When keyboard is closed the spacer is 80px, matching the old pb-20.
 * When keyboard opens the spacer grows, allowing the page to scroll the cursor into view.
 */
export function useKeyboardOffset(baseBottomSpace = 80) {
  const toolbarRef = useRef<HTMLDivElement>(null);
  const spacerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;

    // Capture stable height before keyboard ever opens.
    // In PWA standalone mode window.innerHeight shrinks with the keyboard,
    // so we capture the initial value as reference.
    const stableHeight = window.innerHeight;

    const update = () => {
      const offset = Math.max(0, stableHeight - vv.height - vv.offsetTop);
      if (toolbarRef.current) toolbarRef.current.style.bottom = `${offset}px`;
      if (spacerRef.current) spacerRef.current.style.height = `${offset + baseBottomSpace}px`;
    };

    vv.addEventListener('resize', update);
    vv.addEventListener('scroll', update);
    update();

    return () => {
      vv.removeEventListener('resize', update);
      vv.removeEventListener('scroll', update);
    };
  }, [baseBottomSpace]);

  return { toolbarRef, spacerRef };
}
