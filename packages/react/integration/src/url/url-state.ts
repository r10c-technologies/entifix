import { useCallback, useMemo, useSyncExternalStore } from 'react';

import type { UrlQuery, UrlState } from './url-query.js';

/** Dispatched after a state is written, as `replaceState` fires nothing. */
const SEARCH_CHANGED = 'entifix-url-search-changed';

function subscribe(onChange: () => void) {
  window.addEventListener('popstate', onChange);
  window.addEventListener(SEARCH_CHANGED, onChange);
  return () => {
    window.removeEventListener('popstate', onChange);
    window.removeEventListener(SEARCH_CHANGED, onChange);
  };
}

const currentSearch = () => window.location.search;
const noSearch = () => null;

/**
 * A query's state, read from the URL, and a function writing a new one.
 *
 * The state is `null` while rendering on the server and during hydration: the
 * server-rendered HTML is the page with no filter, which is also what a visitor without
 * scripting keeps. Writing replaces the history entry rather than adding one,
 * so back leaves the page instead of undoing a filter.
 */
export function useUrlState<TKey extends string>(
  query: Pick<UrlQuery<TKey, never>, 'parse' | 'serialize'>,
): readonly [UrlState<TKey> | null, (state: UrlState<TKey>) => void] {
  const search = useSyncExternalStore(subscribe, currentSearch, noSearch);
  const state = useMemo(
    () => (search === null ? null : query.parse(search)),
    [query, search],
  );
  const write = useCallback(
    (next: UrlState<TKey>) => {
      const url = new URL(window.location.href);
      url.search = query.serialize(next);
      window.history.replaceState(window.history.state, '', url);
      window.dispatchEvent(new Event(SEARCH_CHANGED));
    },
    [query],
  );
  return [state, write] as const;
}
