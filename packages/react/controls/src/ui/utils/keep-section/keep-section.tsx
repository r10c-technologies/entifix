'use client';

import { useEffect } from 'react';

/**
 * Carries the section in view across the language switch (ADR 0008): a
 * fragment never reaches a server, so the switch's `href` is given one as it
 * is followed. Without scripting the visitor lands at the top of the other
 * locale. Renders nothing.
 */
export function KeepSection() {
  useEffect(() => {
    const follow = (event: MouseEvent) => {
      const link =
        event.target instanceof Element
          ? event.target.closest<HTMLAnchorElement>('a[data-keep-section]')
          : null;
      if (!link) return;
      const current = document.querySelector('a[data-section][aria-current]');
      const section = current?.getAttribute('data-section');
      link.hash = section ? section : window.location.hash;
    };
    // Capture: the `href` must be set before the browser follows it.
    document.addEventListener('click', follow, true);
    return () => document.removeEventListener('click', follow, true);
  }, []);
  return null;
}
