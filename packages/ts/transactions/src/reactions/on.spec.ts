import {
  DeadlineTag,
  DuplicateKey,
  Failure,
  Overloaded,
  Unavailable,
} from '@entifix/core';
import { Effect, Layer } from 'effect';
import { describe, expect, expectTypeOf, it } from 'vitest';

import { InMemoryRetryBudgetLayer } from '../engine/in-memory-retry-budget.js';
import { RetryBudgetTag } from '../ports/retry-budget.js';
import { On } from './on.js';

const KEY = { dependency: 'stock' };
const FAST = { backoffBaseMs: 1, backoffCapMs: 2 };

/** An effect failing with each of `failures` in turn, then succeeding. */
const flaky = <E>(failures: E[]) => {
  let calls = 0;
  const effect = Effect.suspend(() => {
    calls += 1;
    const failure = failures[calls - 1];
    return failure === undefined ? Effect.succeed('ok') : Effect.fail(failure);
  });
  return { effect, calls: () => calls };
};

const withBudget = (dials = {}) =>
  InMemoryRetryBudgetLayer({ dials: { ...FAST, ...dials } });

const run = <A, E>(
  effect: Effect.Effect<A, E, RetryBudgetTag>,
  layer: Layer.Layer<RetryBudgetTag> = withBudget(),
) => Effect.runPromise(Effect.exit(Effect.provide(effect, layer)));

const transient = On(Failure.isCategory('unavailable'));

describe('On(…).retry', () => {
  it('retries a transient failure and answers what the retry got', async () => {
    const { effect, calls } = flaky([new Unavailable({})]);

    const exit = await run(
      effect.pipe(transient.retry({ key: KEY, idempotent: true })),
    );

    expect(exit).toMatchObject({ _tag: 'Success', value: 'ok' });
    expect(calls()).toBe(2);
  });

  it('stops at the attempt ceiling', async () => {
    const { effect, calls } = flaky(
      Array.from({ length: 5 }, () => new Unavailable({})),
    );

    const exit = await run(
      effect.pipe(transient.retry({ key: KEY, idempotent: true })),
      withBudget({ budgetFloorPerSecond: 10 }),
    );

    expect(exit._tag).toBe('Failure');
    expect(calls()).toBe(3);
  });

  it('refuses further retries once the budget is spent', async () => {
    const { effect, calls } = flaky(
      Array.from({ length: 5 }, () => new Unavailable({})),
    );

    await run(
      effect.pipe(transient.retry({ key: KEY, idempotent: true })),
      withBudget({ budgetFloorPerSecond: 1 }),
    );

    expect(calls()).toBe(2);
  });

  it('never retries a failure the predicate does not admit', async () => {
    const { effect, calls } = flaky([new DuplicateKey({})]);

    await run(
      effect.pipe(
        On(Failure.isTag('DuplicateKey') as never).retry({
          key: KEY,
          idempotent: true,
        }),
      ),
    );
    await run(effect.pipe(transient.retry({ key: KEY, idempotent: true })));

    expect(calls()).toBe(2);
  });

  it('stops on Overloaded wherever it appears', async () => {
    const { effect, calls } = flaky([new Overloaded({})]);

    await run(
      effect.pipe(
        On(Failure.isCategory('exhausted')).retry({
          key: KEY,
          idempotent: true,
        }),
      ),
    );

    expect(calls()).toBe(1);
  });

  it('starts no retry past the request’s deadline', async () => {
    const { effect, calls } = flaky([new Unavailable({}), new Unavailable({})]);

    await run(
      effect.pipe(
        transient.retry({ key: KEY, idempotent: true }),
        Effect.provideService(DeadlineTag, { expiresAt: Date.now() - 1 }),
      ),
    );

    expect(calls()).toBe(1);
  });

  it('answers a locally throttled first attempt as Overloaded', async () => {
    const throttling = Layer.succeed(RetryBudgetTag, {
      dials: { ...FAST } as never,
      admitAttempt: () => Effect.succeed(false),
      admitRetry: () => Effect.succeed(true),
      recordAccepted: () => Effect.void,
    });

    const exit = await run(
      Effect.succeed('never').pipe(
        transient.retry({ key: KEY, idempotent: true }),
      ),
      throttling,
    );

    expect(exit._tag === 'Failure' && JSON.stringify(exit.cause)).toContain(
      'Overloaded',
    );
  });

  it('refuses to be built on a call that is not idempotent', () => {
    expect(() => transient.retry({ key: KEY, idempotent: false })).toThrow(
      /not idempotent/,
    );
  });

  it('is not offered on a predicate that admits a business failure', () => {
    expectTypeOf(On(Failure.isFamily('business')).retry).toEqualTypeOf<never>();
    expectTypeOf(
      On(Failure.isCategory('conflict')).retry,
    ).toEqualTypeOf<never>();
  });
});

describe('the other reactions', () => {
  it('recovers a matching failure with an outcome, narrowing E', async () => {
    const effect = Effect.fail(new Unavailable({})) as Effect.Effect<
      string,
      Unavailable | DuplicateKey
    >;

    const recovered = effect.pipe(transient.recover(() => 'cached'));
    expectTypeOf(recovered).toEqualTypeOf<
      Effect.Effect<string, DuplicateKey>
    >();

    expect(await Effect.runPromise(recovered)).toBe('cached');
  });

  it('falls back to another effect', async () => {
    const effect = Effect.fail(new Unavailable({}));

    expect(
      await Effect.runPromise(
        effect.pipe(transient.fallback(() => Effect.succeed('elsewhere'))),
      ),
    ).toBe('elsewhere');
  });

  it('delays a matching failure before letting it through', async () => {
    const started = Date.now();

    const exit = await Effect.runPromise(
      Effect.exit(Effect.fail(new Unavailable({})).pipe(transient.delay(20))),
    );

    expect(exit._tag).toBe('Failure');
    expect(Date.now() - started).toBeGreaterThanOrEqual(15);
  });

  it('leaves a failure it does not admit alone', async () => {
    const exit = await Effect.runPromise(
      Effect.exit(
        Effect.fail(new DuplicateKey({})).pipe(
          transient.recover(() => 'x'),
          transient.fallback(() => Effect.succeed('y')),
          transient.delay(1),
        ),
      ),
    );

    expect(exit._tag).toBe('Failure');
  });

  it('asks a condition read from the context, and keeps E when it may say no', async () => {
    const unlessFlagged = On(
      Failure.when(Failure.isCategory('unavailable'), () =>
        Effect.succeed(false),
      ),
    );
    const effect = Effect.fail(new Unavailable({})) as Effect.Effect<
      string,
      Unavailable
    >;

    const recovered = effect.pipe(unlessFlagged.recover(() => 'x'));
    expectTypeOf(recovered).toEqualTypeOf<Effect.Effect<string, Unavailable>>();

    expect((await Effect.runPromise(Effect.exit(recovered)))._tag).toBe(
      'Failure',
    );
  });
});
