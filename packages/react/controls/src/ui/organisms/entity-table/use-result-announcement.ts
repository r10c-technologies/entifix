import { useEffect, useRef, useState } from 'react';

/** How long the results settle before they are said: a burst of typing is one. */
export const RESULT_ANNOUNCEMENT_DELAY_MS = 500;

/**
 * What a table's status region says after its results change — a filter, a
 * sort or a page — and nothing on the first load, which the reader asked for
 * by arriving rather than by acting.
 *
 * `signature` names the query the results answer, so a change that happens to
 * keep the same count is still said: the text is nudged with a non-breaking
 * space, because a live region repeats nothing that did not change.
 */
export function useResultAnnouncement(
  settled: boolean,
  message: string,
  signature: string,
  delay = RESULT_ANNOUNCEMENT_DELAY_MS,
): string {
  const [said, setSaid] = useState('');
  const firstSettled = useRef(true);

  useEffect(() => {
    if (!settled) return;
    if (firstSettled.current) {
      firstSettled.current = false;
      return;
    }
    const timer = setTimeout(
      () =>
        setSaid(previous =>
          previous === message ? `${message}\u00a0` : message,
        ),
      delay,
    );
    return () => clearTimeout(timer);
  }, [settled, message, signature, delay]);

  return said;
}
