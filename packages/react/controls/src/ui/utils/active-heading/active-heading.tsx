'use client';

import { useEffect } from 'react';

/** How far down the window a heading must have come to be the current one. */
const LINE = 0.3;

/**
 * Marks the table-of-contents anchor of the heading being read with
 * `aria-current`, as `ActiveSection` marks a page's nav: an enhancement over
 * anchors that already work. Renders nothing.
 *
 * A heading is a point, not a section, so it never stays in a band: the one
 * being read is the last whose top has passed a line 30% down the window —
 * none above the first. Checked once per frame while scrolling.
 *
 * Where the links sit in a row that scrolls sideways (a phone's strip), the
 * newly marked one is scrolled to the row's middle, so it stays in sight.
 */
export function ActiveHeading({ ids }: { ids: readonly string[] }) {
  useEffect(() => {
    const links = new Map(
      ids.map(id => [
        id,
        document.querySelectorAll<HTMLAnchorElement>(`a[data-section="${id}"]`),
      ]),
    );
    const headings = ids.flatMap(id => {
      const heading = document.getElementById(id);
      return heading === null ? [] : [heading];
    });
    let marked: string | undefined;
    const mark = () => {
      const line = window.innerHeight * LINE;
      let current: string | undefined;
      for (const heading of headings)
        if (heading.getBoundingClientRect().top <= line) current = heading.id;
      for (const [id, anchors] of links)
        for (const anchor of anchors)
          if (id === current) anchor.setAttribute('aria-current', 'location');
          else anchor.removeAttribute('aria-current');
      if (current !== marked && current !== undefined)
        // Every heading found is one of `ids`, each with its anchors.
        for (const anchor of links.get(current) as Iterable<HTMLElement>)
          reveal(anchor);
      marked = current;
    };
    let frame = 0;
    const onScroll = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(mark);
    };
    mark();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll, { passive: true });
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
    };
  }, [ids]);
  return null;
}

/** Scrolls a link to the middle of its list, if the list scrolls sideways. */
function reveal(anchor: HTMLElement) {
  const list = anchor.closest('ol, ul');
  if (list === null || list.scrollWidth <= list.clientWidth) return;
  const link = anchor.getBoundingClientRect();
  const box = list.getBoundingClientRect();
  list.scrollLeft += link.left - box.left - (box.width - link.width) / 2;
}
