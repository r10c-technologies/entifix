import { Failure } from '@entifix/core';
import { Context, type Effect, Metric, Schema } from 'effect';

/**
 * The bulkhead for a key had no permit free. `exhausted`, and it stops every
 * retry above it: the calls already in flight are the ones to wait for.
 */
export class BulkheadFull extends Failure.exhausted<BulkheadFull>()(
  'BulkheadFull',
  'bulkheadFull',
  { dependency: Schema.String },
  {
    message: ({ dependency }) =>
      `every permit to '${dependency}' is taken; the call was not made`,
  },
) {}

/**
 * Bounds how many calls to one dependency run at once, per key
 * ([ADR 0017](../../../../../docs/adr/0017-circuit-breaker-and-bulkhead-ports.md)),
 * so a slow participant holds a bounded share of the process rather than all
 * of it. A call that finds no permit is refused at once, never queued.
 */
export interface Bulkhead {
  readonly withPermit: (
    key: string,
  ) => <A, E, R>(
    effect: Effect.Effect<A, E, R>,
  ) => Effect.Effect<A, E | BulkheadFull, R>;
  /** Permits taken now. */
  readonly inUse: (key: string) => Effect.Effect<number>;
}

export class BulkheadTag extends Context.Service<BulkheadTag, Bulkhead>()(
  '@entifix/transactions/Bulkhead',
) {}

/** Permits in use, by key. */
export const bulkheadInUse = Metric.gauge('entifix_bulkhead_in_use', {
  description: 'Bulkhead permits in use, by key.',
});
