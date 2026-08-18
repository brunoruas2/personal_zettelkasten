'use client';

import type { ComponentPropsWithoutRef } from 'react';

type Props = ComponentPropsWithoutRef<'a'> & { href: string };

/**
 * Drop-in replacement for Next.js <Link> on routes that may not be cached offline.
 *
 * Always uses hard navigation (window.location) so the service worker intercepts
 * and serves the cached app shell. navigator.onLine is unreliable on iOS Safari —
 * it returns true even in airplane mode — so we don't use it.
 *
 * Child elements can call e.preventDefault() to stop navigation (e.g. tag/delete
 * buttons inside a card), exactly as they would with Next.js <Link>.
 */
export function OfflineLink({ href, onClick, children, ...props }: Props) {
  return (
    <a
      href={href}
      onClick={(e) => {
        onClick?.(e);
        // If a child handler called e.preventDefault(), respect it.
        if (e.defaultPrevented) return;
        e.preventDefault();
        window.location.href = href;
      }}
      {...props}
    >
      {children}
    </a>
  );
}
