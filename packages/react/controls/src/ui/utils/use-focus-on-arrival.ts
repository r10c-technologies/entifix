'use client';

import { type RefObject, useEffect, useEffectEvent } from 'react';

/**
 * Whether the reader has pressed a key or a pointer in this document yet. A
 * page that mounts before that is the one they loaded, and its focus is the
 * browser's to place; one that mounts after was reached by doing something.
 */
let interacted = false;

/**
 * The element that last took focus, whatever it was. `focusin` always fires on
 * the way in, while nothing reliable fires when a focused element is removed —
 * so this is what tells a dropped focus from one that was never anywhere.
 */
let lastFocused: Element | undefined;

/* v8 ignore next -- a server render has no document to listen on */
if (typeof document !== 'undefined') {
  const mark = () => {
    interacted = true;
  };
  document.addEventListener('pointerdown', mark, { capture: true });
  document.addEventListener('keydown', mark, { capture: true });
  document.addEventListener(
    'focusin',
    event => {
      lastFocused = event.target as Element;
    },
    { capture: true },
  );
}

/** For specs: the document as it was before anyone touched it. */
export const resetArrivalForTesting = () => {
  interacted = false;
  lastFocused = undefined;
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

/**
 * Keeps focus off `<body>` when the control holding it goes away under the
 * reader: a verb that ran and moved its record into a state the verb no longer
 * applies to unmounts the very button that was focused, and the browser drops
 * focus to the document. Each time `revision` changes — the set of verbs on
 * show — focus goes to `target()`, but **only** when the element that last held
 * it has left the document and nothing has taken focus since. A revision that
 * removed nothing the reader was on moves nothing, so a live update to some
 * other row never pulls focus around.
 */
export function useFocusOnLoss(
  target: () => HTMLElement | null | undefined,
  revision: string,
): void {
  const refocus = useEffectEvent(() => {
    const active = document.activeElement;
    if (active !== null && active !== document.body) return;
    if (lastFocused === undefined || lastFocused.isConnected) return;
    target()?.focus();
  });
  useEffect(() => refocus(), [revision]);
}
