import { Failure } from '@entifix/core';
import { Context, type Effect, Metric, Schema } from 'effect';

/**
 * Where a breaker stands
 * ([ADR 0017](../../../../../docs/adr/0017-circuit-breaker-and-bulkhead-ports.md)).
 * `forcedOpen` and `disabled` are an operator's: the first refuses every call,
 * the second lets every call through and records none.
 */
export type BreakerState =
  'closed' | 'open' | 'halfOpen' | 'forcedOpen' | 'disabled';

/** The dials of one breaker, Resilience4j's names for Resilience4j's model. */
export interface BreakerDials {
  /** `count` keeps the last `windowSize` calls; `time` the last `windowSize` seconds. */
  readonly windowType: 'count' | 'time';
  readonly windowSize: number;
  /** Fraction of recorded calls that failed, at or above which the breaker opens. */
  readonly failureRateThreshold: number;
  /** Fraction of calls slower than `slowCallDurationMs`, at or above which it opens. */
  readonly slowCallRateThreshold: number;
  readonly slowCallDurationMs: number;
  /** Calls the window must hold before either rate is read into it. */
  readonly minimumCalls: number;
  /** How long it stays open before letting probes through. */
  readonly waitInOpenMs: number;
  /** Calls let through half-open; their outcome closes or reopens it. */
  readonly halfOpenPermits: number;
}

export const DEFAULT_BREAKER_DIALS: BreakerDials = {
  windowType: 'count',
  windowSize: 20,
  failureRateThreshold: 0.5,
  slowCallRateThreshold: 1,
  slowCallDurationMs: 2_000,
  minimumCalls: 5,
  waitInOpenMs: 10_000,
  halfOpenPermits: 2,
};

/**
 * The breaker for a key refused the call. `unavailable`, because the
 * dependency is, and it stops every retry above it: retrying into an open
 * breaker is what the breaker exists to prevent.
 */
export class BreakerOpen extends Failure.unavailable<BreakerOpen>()(
  'BreakerOpen',
  'breakerOpen',
  { dependency: Schema.String },
  {
    message: ({ dependency }) =>
      `the circuit to '${dependency}' is open; the call was not made`,
  },
) {}

/**
 * Stops calls to a dependency that is failing, per key — a participant, or a
 * participant and a route. Records only technical failures other than
 * `protocol`: a business failure is an answer and never trips it, and a
 * protocol failure is a bug that waiting does not fix.
 */
export interface CircuitBreaker {
  readonly guard: (
    key: string,
  ) => <A, E, R>(
    effect: Effect.Effect<A, E, R>,
  ) => Effect.Effect<A, E | BreakerOpen, R>;
  /** The state now — an elapsed wait in open reads as half-open. */
  readonly state: (key: string) => Effect.Effect<BreakerState>;
  /** An operator's override; `closed` hands the breaker back to its window. */
  readonly force: (
    key: string,
    state: 'forcedOpen' | 'disabled' | 'closed',
  ) => Effect.Effect<void>;
}

export class CircuitBreakerTag extends Context.Service<
  CircuitBreakerTag,
  CircuitBreaker
>()('@entifix/transactions/CircuitBreaker') {}

/** A breaker's state per key: 0 closed, 1 open, 2 half-open, 3 forced open, 4 disabled. */
export const breakerState = Metric.gauge('entifix_breaker_state', {
  description: 'Circuit breaker state, by key.',
});

/** Transitions, by key, source and target state. */
export const breakerTransitions = Metric.counter(
  'entifix_breaker_transitions_total',
  { description: 'Circuit breaker state transitions, by key and states.' },
);

/** Calls an open breaker refused, by key. */
export const breakerRejections = Metric.counter(
  'entifix_breaker_rejected_total',
  { description: 'Calls refused by an open circuit breaker, by key.' },
);

/** The number each state reports on {@link breakerState}. */
export const BREAKER_STATE_VALUE: Readonly<Record<BreakerState, number>> = {
  closed: 0,
  open: 1,
  halfOpen: 2,
  forcedOpen: 3,
  disabled: 4,
};
