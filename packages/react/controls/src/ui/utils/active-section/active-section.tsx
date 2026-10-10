'use client';

import { useEffect } from 'react';

/**
 * Marks the nav anchor of the section in view with `aria-current`: an
 * enhancement over anchors that already work (ADR 0008). Renders nothing.
 *
 * A section counts as in view while it crosses the band just above the
 * viewport's middle; over the hero, none does.
 */
export function ActiveSection({ sections }: { sections: readonly string[] }) {
  useEffect(() => {
    const links = new Map(
      sections.map(id => [
        id,
        document.querySelectorAll<HTMLAnchorElement>(`a[data-section="${id}"]`),
      ]),
    );
    const visible = new Set<string>();
    const mark = () => {
      const current = sections.find(id => visible.has(id));
      for (const [id, anchors] of links) {
        for (const anchor of anchors) {
          if (id === current) anchor.setAttribute('aria-current', 'location');
          else anchor.removeAttribute('aria-current');
        }
      }
    };
    const observer = new IntersectionObserver(
      entries => {
        for (const entry of entries) {
          if (entry.isIntersecting) visible.add(entry.target.id);
          else visible.delete(entry.target.id);
        }
        mark();
      },
      { rootMargin: '-40% 0px -55% 0px' },
    );
    for (const id of sections) {
      const section = document.getElementById(id);
      if (section) observer.observe(section);
    }
    return () => observer.disconnect();
  }, [sections]);
  return null;
}
