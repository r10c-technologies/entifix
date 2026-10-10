/**
 * jsdom has no `matchMedia`. A stand-in that answers width queries — `(width
 * >= 64rem)`, `(width < 40rem)`, `(min-width: 48rem)`, `(max-width: 24rem)` —
 * against a width a spec sets, 16px to the rem, and tells every live query
 * list when that width changes. Anything else never matches.
 */
import { vi } from 'vitest';

/** A desk's width, until a spec says otherwise. */
const DEFAULT_WIDTH = 1280;

const QUERY =
  /^\(\s*(?:width\s*(>=|>|<=|<)\s*|(min|max)-width:\s*)([\d.]+)(rem|px)\s*\)$/;

let width = DEFAULT_WIDTH;
const lists = new Set<{ notify: () => void }>();

function matches(query: string): boolean {
  const found = QUERY.exec(query.trim());
  if (found === null) return false;
  const [, operator, bound, value, unit] = found;
  const limit = Number(value) * (unit === 'rem' ? 16 : 1);
  const op = operator ?? (bound === 'min' ? '>=' : '<=');
  if (op === '>=') return width >= limit;
  if (op === '>') return width > limit;
  if (op === '<=') return width <= limit;
  return width < limit;
}

/** Installs the stand-in on `window`, at the default width. */
export function installMatchMedia() {
  width = DEFAULT_WIDTH;
  lists.clear();
  vi.stubGlobal(
    'matchMedia',
    vi.fn((media: string) => {
      const listeners = new Set<(event: MediaQueryListEvent) => void>();
      const list = {
        media,
        get matches() {
          return matches(media);
        },
        addEventListener: (
          _: string,
          listener: (event: MediaQueryListEvent) => void,
        ) => listeners.add(listener),
        removeEventListener: (
          _: string,
          listener: (event: MediaQueryListEvent) => void,
        ) => listeners.delete(listener),
        notify: () => {
          for (const listener of listeners)
            listener({ matches: matches(media), media } as MediaQueryListEvent);
        },
      };
      lists.add(list);
      return list;
    }),
  );
}

/** Resizes the window: every live query list hears of it. */
export function setViewportWidth(pixels: number) {
  width = pixels;
  for (const list of lists) list.notify();
}
