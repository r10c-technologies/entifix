import { isFailure } from '@entifix/core';
import { Cause, Effect, Exit, Layer, Metric } from 'effect';

import {
  BREAKER_STATE_VALUE,
  type BreakerDials,
  BreakerOpen,
  breakerRejections,
  type BreakerState,
  breakerState,
  breakerTransitions,
  type CircuitBreaker,
  CircuitBreakerTag,
  DEFAULT_BREAKER_DIALS,
} from '../ports/circuit-breaker.js';

/** One call's outcome, as the window holds it. */
interface Recorded {
  readonly at: number;
  readonly failed: boolean;
  readonly slow: boolean;
}

interface Circuit {
  state: BreakerState;
  /** When it opened, and how long it waits — a `Retry-After` may lengthen it. */
  openedAt: number;
  waitMs: number;
  window: Recorded[];
  /** Half-open: probes let through, and their outcomes. */
  admitted: number;
  probes: Recorded[];
}

export interface InMemoryCircuitBreakerOptions {
  /** Dials for every key, over the defaults. */
  readonly dials?: Partial<BreakerDials>;
  /** Dials for one key, over `dials` — a participant's own row. */
  readonly dialsFor?: (key: string) => Partial<BreakerDials> | undefined;
  /** The clock, in epoch milliseconds. Injected so a spec can move time. */
  readonly now?: () => number;
}

/** What a call's exit means to the window: a failure, a success, or neither. */
const verdictOf = (exit: Exit.Exit<unknown, unknown>) => {
  if (Exit.isSuccess(exit)) return { recorded: true, failed: false } as const;
  const failure = Cause.findErrorOption(exit.cause);
  if (failure._tag === 'None') return { recorded: false } as const;
  const error = failure.value;
  // An answer is not a failure of the dependency, and a protocol failure is a
  // bug that waiting does not fix: neither moves the breaker.
  if (!isFailure(error)) return { recorded: false } as const;
  if (error.family === 'business')
    return { recorded: true, failed: false } as const;
  if (error.category === 'protocol') return { recorded: false } as const;
  return { recorded: true, failed: true, failure: error } as const;
};

/** Seconds a dependency asked to be left alone for, when it said so. */
const retryAfterOf = (failure: unknown): number | undefined => {
  const seconds = (failure as { readonly retryAfterSeconds?: unknown })
    .retryAfterSeconds;
  return typeof seconds === 'number' && seconds > 0 ? seconds : undefined;
};

const rates = (calls: readonly Recorded[]) => ({
  failure: calls.filter(call => call.failed).length / calls.length,
  slow: calls.filter(call => call.slow).length / calls.length,
});

/**
 * Per-process breakers, one per key, on Resilience4j's state machine
 * ([ADR 0017](../../../../../docs/adr/0017-circuit-breaker-and-bulkhead-ports.md)).
 *
 * Closed, every call is recorded in a count- or time-based window; once the
 * window holds `minimumCalls` and the failure or slow-call rate reaches its
 * threshold, the breaker opens. A dependency answering with `Retry-After` opens
 * it at once, for at least as long as it asked. Open, every call is refused
 * until `waitInOpenMs` has passed; then `halfOpenPermits` probes go through, and
 * their outcome closes or reopens it.
 *
 * Per process on purpose: a fleet-wide breaker would put a shared store on the
 * hot path, and per-process state converges within a window.
 */
export const makeInMemoryCircuitBreaker = (
  options: InMemoryCircuitBreakerOptions = {},
): CircuitBreaker => {
  const now = options.now ?? Date.now;
  const circuits = new Map<string, Circuit>();
  const dialsOf = (key: string): BreakerDials => ({
    ...DEFAULT_BREAKER_DIALS,
    ...options.dials,
    ...options.dialsFor?.(key),
  });

  const circuitOf = (key: string): Circuit => {
    let circuit = circuits.get(key);
    if (circuit === undefined) {
      circuit = {
        state: 'closed',
        openedAt: 0,
        waitMs: 0,
        window: [],
        admitted: 0,
        probes: [],
      };
      circuits.set(key, circuit);
    }
    return circuit;
  };

  const report = (key: string, circuit: Circuit) =>
    Metric.update(
      Metric.withAttributes(breakerState, { key }),
      BREAKER_STATE_VALUE[circuit.state],
    );

  const move = (key: string, circuit: Circuit, to: BreakerState) => {
    const from = circuit.state;
    circuit.state = to;
    circuit.admitted = 0;
    circuit.probes = [];
    if (to === 'closed') circuit.window = [];
    return Metric.update(
      Metric.withAttributes(breakerTransitions, { key, from, to }),
      1,
    ).pipe(Effect.andThen(report(key, circuit)));
  };

  const open = (key: string, circuit: Circuit, waitMs: number) => {
    circuit.openedAt = now();
    circuit.waitMs = waitMs;
    return move(key, circuit, 'open');
  };

  /** An open breaker whose wait has passed is half-open, read lazily. */
  const settle = (key: string, circuit: Circuit) =>
    circuit.state === 'open' && now() - circuit.openedAt >= circuit.waitMs
      ? move(key, circuit, 'halfOpen')
      : Effect.void;

  const trimmed = (window: Recorded[], dials: BreakerDials): Recorded[] =>
    dials.windowType === 'count'
      ? window.slice(-dials.windowSize)
      : window.filter(call => now() - call.at < dials.windowSize * 1_000);

  const record = (
    key: string,
    circuit: Circuit,
    call: Recorded,
    failure: unknown,
  ) =>
    Effect.suspend(() => {
      const dials = dialsOf(key);
      const retryAfter = call.failed ? retryAfterOf(failure) : undefined;
      if (retryAfter !== undefined && circuit.state !== 'disabled')
        return open(
          key,
          circuit,
          Math.max(dials.waitInOpenMs, retryAfter * 1_000),
        );

      if (circuit.state === 'halfOpen') {
        circuit.probes.push(call);
        if (circuit.probes.length < dials.halfOpenPermits) return Effect.void;
        const probed = rates(circuit.probes);
        return probed.failure >= dials.failureRateThreshold ||
          probed.slow >= dials.slowCallRateThreshold
          ? open(key, circuit, dials.waitInOpenMs)
          : move(key, circuit, 'closed');
      }

      if (circuit.state !== 'closed') return Effect.void;
      circuit.window = trimmed([...circuit.window, call], dials);
      if (circuit.window.length < dials.minimumCalls) return Effect.void;
      const windowed = rates(circuit.window);
      return windowed.failure >= dials.failureRateThreshold ||
        windowed.slow >= dials.slowCallRateThreshold
        ? open(key, circuit, dials.waitInOpenMs)
        : Effect.void;
    });

  const refuse = (key: string) =>
    Metric.update(Metric.withAttributes(breakerRejections, { key }), 1).pipe(
      Effect.andThen(Effect.fail(new BreakerOpen({ dependency: key }))),
    );

  return {
    guard:
      key =>
      <A, E, R>(effect: Effect.Effect<A, E, R>) =>
        Effect.gen(function* () {
          const circuit = circuitOf(key);
          yield* settle(key, circuit);
          if (circuit.state === 'disabled') return yield* effect;
          if (circuit.state === 'open' || circuit.state === 'forcedOpen')
            return yield* refuse(key);
          if (circuit.state === 'halfOpen') {
            const dials = dialsOf(key);
            if (circuit.admitted >= dials.halfOpenPermits)
              return yield* refuse(key);
            circuit.admitted += 1;
          }

          const startedAt = now();
          const exit = yield* Effect.exit(effect);
          const verdict = verdictOf(exit);
          if (verdict.recorded)
            yield* record(
              key,
              circuit,
              {
                at: startedAt,
                failed: verdict.failed,
                slow: now() - startedAt > dialsOf(key).slowCallDurationMs,
              },
              verdict.failed ? verdict.failure : undefined,
            );
          return yield* exit;
        }),

    state: key =>
      Effect.gen(function* () {
        const circuit = circuitOf(key);
        yield* settle(key, circuit);
        return circuit.state;
      }),

    force: (key, state) =>
      Effect.suspend(() => move(key, circuitOf(key), state)),
  };
};

/** One breaker set for the process, for the composition root. */
export const InMemoryCircuitBreakerLayer = (
  options: InMemoryCircuitBreakerOptions = {},
) => Layer.sync(CircuitBreakerTag, () => makeInMemoryCircuitBreaker(options));
