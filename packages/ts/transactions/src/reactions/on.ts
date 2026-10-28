import {
  type BusinessCategory,
  currentRemainingMs,
  type EffectfulFailurePredicate,
  type FailureGuard,
  isFailure,
  Overloaded,
} from '@entifix/core';
import { type Duration, Effect, Metric } from 'effect';

import {
  retryAttempts,
  type RetryBudget,
  retryBudgetRejections,
  RetryBudgetTag,
  type RetryKey,
  retryThrottled,
} from '../ports/retry-budget.js';

/**
 * A retry is legal on a call only when repeating it cannot do the thing twice:
 * a read, or a write carrying an `Idempotency-Key`. The caller states it; the
 * reaction refuses to be built when it is false, so the mistake is a boot
 * failure rather than a second charge.
 */
export interface RetryOptions {
  readonly key: RetryKey;
  readonly idempotent: boolean;
}

/** Tags that stop retries wherever they appear: the dependency asked for less. */
const STOPS_RETRIES: ReadonlySet<string> = new Set([
  'Overloaded',
  'BreakerOpen',
]);

type AdmitsBusiness<S> = S extends { readonly family: 'business' }
  ? true
  : S extends { readonly category: BusinessCategory }
    ? true
    : false;

type Remaining<E, S, Narrows extends boolean> = Narrows extends true
  ? Exclude<E, S>
  : E;

/**
 * The reactions a shell composes onto an effect, each a plain
 * `(self) => Effect` transform — no rule language, because a reaction is an
 * Effect function and the compiler already checks those
 * ([ADR 0013](../../../../../docs/adr/0013-failures-are-typed-values-decided-at-the-shell.md)).
 */
export interface Reactions<S, RP, Narrows extends boolean> {
  /**
   * Retry the matching failures, once per attempt the budget admits, with full
   * jitter, never past the request's deadline
   * ([ADR 0014](../../../../../docs/adr/0014-retry-once-at-the-layer-above-under-a-budget.md)).
   *
   * Not available on a predicate that admits a business failure: an answer
   * retried is the same answer, and the type says so before anything runs.
   */
  readonly retry: AdmitsBusiness<S> extends true
    ? never
    : (
        options: RetryOptions,
      ) => <A, E, R>(
        self: Effect.Effect<A, E, R>,
      ) => Effect.Effect<A, E | Overloaded, R | RP | RetryBudgetTag>;
  /** Wait before letting a matching failure through — pacing, not a retry. */
  readonly delay: (
    duration: Duration.Input,
  ) => <A, E, R>(self: Effect.Effect<A, E, R>) => Effect.Effect<A, E, R | RP>;
  /** Run another effect in place of a matching failure. */
  readonly fallback: <B, E2, R2>(
    other: (failure: S) => Effect.Effect<B, E2, R2>,
  ) => <A, E, R>(
    self: Effect.Effect<A, E, R>,
  ) => Effect.Effect<A | B, Remaining<E, S, Narrows> | E2, R | R2 | RP>;
  /** Answer a matching failure with an outcome. */
  readonly recover: <B>(
    toOutcome: (failure: S) => B,
  ) => <A, E, R>(
    self: Effect.Effect<A, E, R>,
  ) => Effect.Effect<A | B, Remaining<E, S, Narrows>, R | RP>;
}

const fullJitter = (attempt: number, base: number, cap: number) =>
  Math.random() * Math.min(cap, base * 2 ** (attempt - 1));

const count = (counter: Metric.Counter<number>, key: RetryKey) =>
  Metric.update(
    Metric.withAttributes(counter, { dependency: key.dependency }),
    1,
  );

/**
 * Reactions to the failures `predicate` admits.
 *
 * Given a guard, the reactions that consume a failure narrow `E`; given a
 * guard with a condition (`Failure.when`), they cannot — the condition may say
 * no at run time — and `E` is left as it was.
 */
export function On<S>(guard: FailureGuard<S>): Reactions<S, never, true>;
export function On<S, RP>(
  predicate: EffectfulFailurePredicate<S, RP>,
): Reactions<S, RP, false>;
export function On<S, RP>(
  predicate: FailureGuard<S> | EffectfulFailurePredicate<S, RP>,
): Reactions<S, RP, boolean> {
  const guard = typeof predicate === 'function' ? predicate : predicate.guard;
  const matches = (failure: unknown): Effect.Effect<boolean, never, RP> =>
    !guard(failure)
      ? Effect.succeed(false)
      : typeof predicate === 'function'
        ? Effect.succeed(true)
        : predicate.condition(failure);

  const retry = (options: RetryOptions) => {
    if (!options.idempotent)
      throw new Error(
        `On(…).retry on '${options.key.dependency}' is refused: the call is ` +
          'not idempotent, so a retry could do it twice. Make it a read or ' +
          'give it an Idempotency-Key.',
      );

    return <A, E, R>(self: Effect.Effect<A, E, R>) =>
      Effect.gen(function* () {
        const budget = yield* RetryBudgetTag;
        if (!(yield* budget.admitAttempt(options.key))) {
          yield* count(retryThrottled, options.key);
          return yield* Effect.fail(new Overloaded({}));
        }
        return yield* attempt(self, budget, 1);
      });

    function attempt<A, E, R>(
      self: Effect.Effect<A, E, R>,
      budget: RetryBudget,
      n: number,
    ): Effect.Effect<A, E | Overloaded, R | RP> {
      return self.pipe(
        Effect.tap(() => budget.recordAccepted(options.key)),
        Effect.catch(error =>
          Effect.gen(function* () {
            // An answer, even a refusal, is the dependency working.
            if (isFailure(error) && error.family === 'business') {
              yield* budget.recordAccepted(options.key);
              return yield* Effect.fail(error);
            }
            const stop =
              !(yield* matches(error)) ||
              (isFailure(error) && STOPS_RETRIES.has(error._tag)) ||
              n >= budget.dials.maxAttempts;
            if (stop) return yield* Effect.fail(error);

            const wait = fullJitter(
              n,
              budget.dials.backoffBaseMs,
              budget.dials.backoffCapMs,
            );
            const remaining = yield* currentRemainingMs;
            if (remaining !== undefined && remaining <= wait)
              return yield* Effect.fail(error);

            if (!(yield* budget.admitRetry(options.key))) {
              yield* count(retryBudgetRejections, options.key);
              return yield* Effect.fail(error);
            }
            yield* count(retryAttempts, options.key);
            yield* Effect.sleep(wait);
            return yield* attempt(self, budget, n + 1);
          }),
        ),
      );
    }
  };

  return {
    retry: retry as Reactions<S, RP, boolean>['retry'],
    delay: duration => self =>
      self.pipe(
        Effect.catch(error =>
          Effect.flatMap(matches(error), matched =>
            matched
              ? Effect.sleep(duration).pipe(Effect.andThen(Effect.fail(error)))
              : Effect.fail(error),
          ),
        ),
      ),
    fallback: other => self =>
      self.pipe(
        Effect.catch(error =>
          Effect.flatMap(matches(error), matched =>
            matched
              ? (other(error as unknown as S) as Effect.Effect<
                  unknown,
                  unknown,
                  unknown
                >)
              : Effect.fail(error),
          ),
        ),
      ) as never,
    recover: toOutcome => self =>
      self.pipe(
        Effect.catch(error =>
          Effect.flatMap(matches(error), matched =>
            matched
              ? Effect.succeed(toOutcome(error as unknown as S))
              : Effect.fail(error),
          ),
        ),
      ) as never,
  };
}
