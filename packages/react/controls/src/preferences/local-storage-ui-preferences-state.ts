import { Unavailable } from '@entifix/core';
import { Effect, Layer } from 'effect';

import {
  type UiPreferencesState,
  UiPreferencesStateTag,
} from './ui-preferences-state.js';

export const DEFAULT_UI_PREFERENCES_NAMESPACE = 'entifix-ui';

/** No `window` during SSR — reads resolve empty and writes are dropped. */
function isBrowser(): boolean {
  return typeof window !== 'undefined' && !!window.localStorage;
}

/**
 * `localStorage`-backed {@link UiPreferencesState}. Every method closes over the
 * namespace, so each one is `R = never` and the object satisfies the interface
 * without leaking a requirement into callers (the same shape
 * `makeMongoRepository` uses).
 *
 * Values are JSON-encoded. Unparseable entries resolve to `undefined` rather
 * than failing: a stale or hand-edited key should fall back to defaults, not
 * break the view.
 */
export function makeLocalStorageUiPreferencesState(
  namespace: string = DEFAULT_UI_PREFERENCES_NAMESPACE,
): UiPreferencesState {
  const storageKey = (key: string) => `${namespace}:${key}`;

  return {
    read: <TValue>(key: string) =>
      Effect.try({
        try: () => {
          if (!isBrowser()) return undefined;
          const raw = window.localStorage.getItem(storageKey(key));
          if (raw === null) return undefined;
          try {
            return JSON.parse(raw) as TValue;
          } catch {
            return undefined;
          }
        },
        catch: () => new Unavailable({ dependency: 'localStorage' }),
      }),

    write: <TValue>(key: string, value: TValue) =>
      Effect.try({
        try: () => {
          if (!isBrowser()) return;
          window.localStorage.setItem(storageKey(key), JSON.stringify(value));
        },
        catch: () => new Unavailable({ dependency: 'localStorage' }),
      }),

    remove: (key: string) =>
      Effect.try({
        try: () => {
          if (!isBrowser()) return;
          window.localStorage.removeItem(storageKey(key));
        },
        catch: () => new Unavailable({ dependency: 'localStorage' }),
      }),
  };
}

export const LocalStorageUiPreferencesLayer = Layer.succeed(
  UiPreferencesStateTag,
  makeLocalStorageUiPreferencesState(),
);
