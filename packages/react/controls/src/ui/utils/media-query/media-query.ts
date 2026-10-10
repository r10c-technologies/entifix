'use client';

import { useCallback, useSyncExternalStore } from 'react';

/**
 * Whether a media query matches, kept in step as the window changes. The
 * server, and the first render in the browser, see `serverValue`: hydration
 * then moves to the real answer without a mismatch.
 */
export function useMediaQuery(query: string, serverValue: boolean): boolean {
  const subscribe = useCallback(
    (onChange: () => void) => {
      const list = window.matchMedia(query);
      list.addEventListener('change', onChange);
      return () => list.removeEventListener('change', onChange);
    },
    [query],
  );
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(query).matches,
    () => serverValue,
  );
}
