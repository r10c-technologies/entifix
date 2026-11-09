'use client';

import { type RefObject, useEffect } from 'react';

/**
 * Whether the reader has pressed a key or a pointer in this document yet. A
 * page that mounts before that is the one they loaded, and its focus is the
 * browser's to place; one that mounts after was reached by doing something.
 */
let interacted = false;

/* v8 ignore next -- a server render has no document to listen on */
if (typeof document !== 'undefined') {
  const mark = () => {
    interacted = true;
  };
  document.addEventListener('pointerdown', mark, { capture: true });
  document.addEventListener('keydown', mark, { capture: true });
}

/** For specs: the document as it was before anyone touched it. */
export const resetArrivalForTesting = () => {
  interacted = false;
};

/**
 * Moves focus to a region's heading when the region arrives under a reader
 * whose focus was dropped — a save that returned to the list, a delete, a
 * wizard handing off to the record it made — so it never rests on `<body>`
 * (ADR 0028). The heading needs `tabIndex={-1}`.
 *
 * Only then: on the page the reader loaded nothing has been dropped, and where
 * focus is on something — a tab they clicked — it stays there.
 */
export function useFocusOnArrival(
  heading: RefObject<HTMLElement | null>,
): void {
  useEffect(() => {
    if (!interacted) return;
    const active = document.activeElement;
    if (active !== null && active !== document.body) return;
    heading.current?.focus();
  }, [heading]);
}
