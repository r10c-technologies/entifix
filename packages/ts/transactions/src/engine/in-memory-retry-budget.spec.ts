import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { RetryBudgetTag } from '../ports/retry-budget.js';
import {
  InMemoryRetryBudgetLayer,
  makeInMemoryRetryBudget,
} from './in-memory-retry-budget.js';

const KEY = { dependency: 'stock' };
const run = <A>(effect: Effect.Effect<A>) => Effect.runSync(effect);

const budgetAt = (clock: { now: number }, random = () => 0.99) =>
  makeInMemoryRetryBudget({
    dials: { budgetRatio: 0.1, budgetFloorPerSecond: 1 },
    now: () => clock.now,
    random,
  });

describe('the in-memory retry budget', () => {
  it('admits a first failure’s retry from one second of floor', () => {
    const budget = budgetAt({ now: 0 });

    expect(run(budget.admitRetry(KEY))).toBe(true);
    expect(run(budget.admitRetry(KEY))).toBe(false);
  });

  it('lets retries add at most the ratio to first attempts', () => {
    const clock = { now: 0 };
    const budget = budgetAt(clock);
    run(budget.admitRetry(KEY));

    for (let i = 0; i < 20; i += 1) {
      run(budget.admitAttempt(KEY));
      run(budget.recordAccepted(KEY));
    }

    expect(run(budget.admitRetry(KEY))).toBe(true);
    expect(run(budget.admitRetry(KEY))).toBe(true);
    expect(run(budget.admitRetry(KEY))).toBe(false);
  });

  it('refills the floor with time, capped', () => {
    const clock = { now: 0 };
    const budget = budgetAt(clock);
    run(budget.admitRetry(KEY));
    clock.now = 3_600_000;

    const admitted = Array.from({ length: 20 }, () =>
      run(budget.admitRetry(KEY)),
    ).filter(Boolean).length;

    expect(admitted).toBe(10);
  });

  it('keeps one budget per dependency and organization', () => {
    const budget = budgetAt({ now: 0 });
    run(budget.admitRetry({ dependency: 'stock', organizationId: 'a' }));

    expect(
      run(budget.admitRetry({ dependency: 'stock', organizationId: 'b' })),
    ).toBe(true);
  });

  it('throttles first attempts locally once requests outrun accepts', () => {
    const budget = budgetAt({ now: 0 }, () => 0.1);

    const admitted = Array.from({ length: 30 }, () =>
      run(budget.admitAttempt(KEY)),
    );

    expect(admitted.slice(0, 9).every(Boolean)).toBe(true);
    expect(admitted.at(-1)).toBe(false);
  });

  it('forgets requests outside the window', () => {
    const clock = { now: 0 };
    const budget = budgetAt(clock, () => 0.1);
    for (let i = 0; i < 30; i += 1) run(budget.admitAttempt(KEY));
    clock.now = 130_000;

    expect(run(budget.admitAttempt(KEY))).toBe(true);
  });

  it('does not throttle with K at zero', () => {
    const budget = makeInMemoryRetryBudget({
      dials: { adaptiveThrottlingK: 0 },
      random: () => 0,
    });

    expect(
      Array.from({ length: 5 }, () => run(budget.admitAttempt(KEY))),
    ).toEqual([true, true, true, true, true]);
  });

  it('is a layer, on the real clock, with the default dials', () => {
    const budget = run(
      Effect.provide(
        Effect.service(RetryBudgetTag),
        InMemoryRetryBudgetLayer(),
      ),
    );

    expect(budget.dials.maxAttempts).toBe(3);
    expect(run(budget.admitRetry(KEY))).toBe(true);
  });
});
