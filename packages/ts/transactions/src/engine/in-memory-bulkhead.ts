import { Effect, Layer, Metric } from 'effect';

import {
  type Bulkhead,
  BulkheadFull,
  bulkheadInUse,
  BulkheadTag,
} from '../ports/bulkhead.js';

export interface InMemoryBulkheadOptions {
  /** Permits per key unless `permitsFor` names one. */
  readonly permits?: number;
  /** A participant's own permits — its config row. */
  readonly permitsFor?: (key: string) => number | undefined;
}

/** Ten concurrent calls per dependency, unless a dial says otherwise. */
export const DEFAULT_BULKHEAD_PERMITS = 10;

/**
 * A per-process bulkhead: a count of permits per key, taken for the length of
 * a call and given back however it ends. A call that finds none free is
 * refused with `bulkheadFull` at once — queueing it would hold the caller's
 * deadline on a dependency that is already saturated.
 */
export const makeInMemoryBulkhead = (
  options: InMemoryBulkheadOptions = {},
): Bulkhead => {
  const taken = new Map<string, number>();
  const permitsOf = (key: string) =>
    options.permitsFor?.(key) ?? options.permits ?? DEFAULT_BULKHEAD_PERMITS;
  const inUse = (key: string) => taken.get(key) ?? 0;
  const report = (key: string) =>
    Metric.update(Metric.withAttributes(bulkheadInUse, { key }), inUse(key));

  return {
    withPermit:
      key =>
      <A, E, R>(effect: Effect.Effect<A, E, R>) =>
        Effect.acquireUseRelease(
          Effect.suspend(() => {
            if (inUse(key) >= permitsOf(key))
              return Effect.fail(new BulkheadFull({ dependency: key }));
            taken.set(key, inUse(key) + 1);
            return report(key);
          }),
          () => effect,
          () =>
            Effect.suspend(() => {
              taken.set(key, inUse(key) - 1);
              return report(key);
            }),
        ),
    inUse: key => Effect.sync(() => inUse(key)),
  };
};

/** One bulkhead set for the process, for the composition root. */
export const InMemoryBulkheadLayer = (options: InMemoryBulkheadOptions = {}) =>
  Layer.sync(BulkheadTag, () => makeInMemoryBulkhead(options));
