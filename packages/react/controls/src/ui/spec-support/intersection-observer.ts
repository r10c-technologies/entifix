/**
 * jsdom has no `IntersectionObserver`. A stand-in the spec drives by hand: it
 * records what is observed and hands back the callback to report entries
 * through.
 */
import { vi } from 'vitest';

export interface FakeObserver {
  readonly callback: IntersectionObserverCallback;
  readonly observed: Element[];
  readonly disconnect: ReturnType<typeof vi.fn<() => void>>;
}

/** Installs the stand-in; returns the observers it has made, newest last. */
export function stubIntersectionObserver() {
  const made: FakeObserver[] = [];
  vi.stubGlobal(
    'IntersectionObserver',
    class {
      readonly #fake: FakeObserver;

      constructor(callback: IntersectionObserverCallback) {
        this.#fake = { callback, observed: [], disconnect: vi.fn() };
        made.push(this.#fake);
      }

      observe(element: Element) {
        this.#fake.observed.push(element);
      }

      disconnect() {
        this.#fake.disconnect();
      }
    },
  );
  return made;
}
