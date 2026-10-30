import {
  Declined,
  Overloaded,
  ProtocolFailure,
  Unavailable,
} from '@entifix/core';
import type {
  BreakerDials,
  Bulkhead,
  CircuitBreaker,
} from '@entifix/transactions';
import { Effect, Exit, Fiber } from 'effect';
import { describe, expect, it } from 'vitest';

import type { ContractClock } from './idempotency-store.contract.js';

/** What a case is handed: a breaker and a bulkhead over its clock. */
export interface BreakerUnderTest {
  readonly breaker: CircuitBreaker;
  readonly bulkhead: Bulkhead;
}

/** The dials the cases are written against. */
export const BREAKER_CONTRACT_DIALS: BreakerDials = {
  windowType: 'count',
  windowSize: 4,
  failureRateThreshold: 0.5,
  slowCallRateThreshold: 1,
  slowCallDurationMs: 100,
  minimumCalls: 4,
  waitInOpenMs: 1_000,
  halfOpenPermits: 2,
};

/**
 * What every breaker and bulkhead must guarantee
 * ([ADR 0017](../../../../../docs/adr/0017-circuit-breaker-and-bulkhead-ports.md)):
 * a window that opens at its failure or slow-call rate and not before its
 * minimum; an open breaker that refuses without calling, and lets probes
 * through once its wait has passed; probes that close it or reopen it; a
 * `Retry-After` that opens it at once and for as long as was asked; business
 * and protocol failures that never move it; the forced states; and a full
 * bulkhead that refuses rather than queues.
 *
 * `make` builds a fresh pair over the case's clock, with
 * {@link BREAKER_CONTRACT_DIALS} and two bulkhead permits.
 */
export const describeBreakerContract = (
  name: string,
  make: (clock: ContractClock) => Effect.Effect<BreakerUnderTest, unknown>,
): void => {
  const run = <A, E>(effect: Effect.Effect<A, E>) => Effect.runPromise(effect);
  const fresh = async () => {
    let time = Date.UTC(2026, 0, 1);
    const clock: ContractClock = { now: () => time };
    const subject = await run(make(clock));
    return {
      ...subject,
      advance: (ms: number) => {
        time += ms;
      },
    };
  };

  const down = Effect.fail(new Unavailable({ dependency: 'stock' }));
  const fine = Effect.succeed('ok');

  const call = <A, E>(breaker: CircuitBreaker, effect: Effect.Effect<A, E>) =>
    run(Effect.exit(breaker.guard('stock')(effect)));

  const tagOf = (exit: Exit.Exit<unknown, unknown>) =>
    Exit.isFailure(exit)
      ? (Exit.findErrorOption(exit) as { value?: { _tag?: string } }).value
          ?._tag
      : 'success';

  describe(`CircuitBreaker contract: ${name}`, () => {
    it('stays closed below the minimum number of calls', async () => {
      const { breaker } = await fresh();
      for (let index = 0; index < 3; index += 1) await call(breaker, down);

      expect(await run(breaker.state('stock'))).toBe('closed');
    });

    it('opens at the failure rate and refuses without calling', async () => {
      const { breaker } = await fresh();
      await call(breaker, fine);
      await call(breaker, fine);
      await call(breaker, down);
      await call(breaker, down);
      // A call that ran would end in this defect, not in `BreakerOpen`.
      const refused = await call(breaker, Effect.die('the call was made'));

      expect(await run(breaker.state('stock'))).toBe('open');
      expect(tagOf(refused)).toBe('BreakerOpen');
    });

    it('opens on slow calls even when every call succeeded', async () => {
      const subject = await fresh();
      const slow = Effect.sync(() => subject.advance(150));
      for (let index = 0; index < 4; index += 1)
        await call(subject.breaker, slow);

      expect(await run(subject.breaker.state('stock'))).toBe('open');
    });

    it('goes half-open after its wait, and closes when the probes succeed', async () => {
      const subject = await fresh();
      for (let index = 0; index < 4; index += 1)
        await call(subject.breaker, down);
      subject.advance(1_000);

      expect(await run(subject.breaker.state('stock'))).toBe('halfOpen');
      await call(subject.breaker, fine);
      await call(subject.breaker, fine);
      expect(await run(subject.breaker.state('stock'))).toBe('closed');
    });

    it('reopens when the probes fail, and admits no more probes than its permits', async () => {
      const subject = await fresh();
      for (let index = 0; index < 4; index += 1)
        await call(subject.breaker, down);
      subject.advance(1_000);

      const gate = Effect.never;
      const first = Effect.runFork(subject.breaker.guard('stock')(gate));
      const second = Effect.runFork(subject.breaker.guard('stock')(gate));
      await new Promise(resolve => setTimeout(resolve, 0));
      expect(tagOf(await call(subject.breaker, fine))).toBe('BreakerOpen');
      await run(Fiber.interrupt(first));
      await run(Fiber.interrupt(second));

      const reprobe = await fresh();
      for (let index = 0; index < 4; index += 1)
        await call(reprobe.breaker, down);
      reprobe.advance(1_000);
      await call(reprobe.breaker, down);
      await call(reprobe.breaker, fine);
      expect(await run(reprobe.breaker.state('stock'))).toBe('open');
    });

    it('opens at once on Retry-After, for at least as long as was asked', async () => {
      const subject = await fresh();

      await call(
        subject.breaker,
        Effect.fail(new Overloaded({ retryAfterSeconds: 5 })),
      );
      expect(await run(subject.breaker.state('stock'))).toBe('open');
      subject.advance(1_000);
      expect(await run(subject.breaker.state('stock'))).toBe('open');
      subject.advance(4_000);
      expect(await run(subject.breaker.state('stock'))).toBe('halfOpen');
    });

    it('is never moved by a business answer or a protocol failure', async () => {
      const { breaker } = await fresh();
      for (let index = 0; index < 4; index += 1) {
        await call(breaker, Effect.fail(new Declined({})));
        await call(breaker, Effect.fail(new ProtocolFailure({ reason: 'x' })));
      }

      expect(await run(breaker.state('stock'))).toBe('closed');
    });

    it('obeys an operator: forced open refuses, disabled lets all through', async () => {
      const { breaker } = await fresh();

      await run(breaker.force('stock', 'forcedOpen'));
      expect(tagOf(await call(breaker, fine))).toBe('BreakerOpen');

      await run(breaker.force('stock', 'disabled'));
      for (let index = 0; index < 8; index += 1) await call(breaker, down);
      expect(await run(breaker.state('stock'))).toBe('disabled');

      await run(breaker.force('stock', 'closed'));
      expect(tagOf(await call(breaker, fine))).toBe('success');
    });

    it('keeps one key’s failures off another key', async () => {
      const { breaker } = await fresh();
      for (let index = 0; index < 4; index += 1) await call(breaker, down);

      expect(await run(breaker.state('order'))).toBe('closed');
    });
  });

  describe(`Bulkhead contract: ${name}`, () => {
    it('refuses a call past its permits at once, and frees a permit however a call ends', async () => {
      const { bulkhead } = await fresh();
      const held = [
        Effect.runFork(bulkhead.withPermit('stock')(Effect.never)),
        Effect.runFork(bulkhead.withPermit('stock')(Effect.never)),
      ];
      await new Promise(resolve => setTimeout(resolve, 0));

      expect(await run(bulkhead.inUse('stock'))).toBe(2);
      const refused = await run(
        Effect.exit(bulkhead.withPermit('stock')(Effect.succeed('late'))),
      );
      expect(tagOf(refused)).toBe('BulkheadFull');

      await run(Fiber.interrupt(held[0] as Fiber.Fiber<unknown, unknown>));
      await run(
        Effect.exit(
          bulkhead.withPermit('stock')(
            Effect.fail(new Unavailable({ dependency: 'stock' })),
          ),
        ),
      );
      expect(await run(bulkhead.inUse('stock'))).toBe(1);
      await run(Fiber.interrupt(held[1] as Fiber.Fiber<unknown, unknown>));
      expect(await run(bulkhead.inUse('stock'))).toBe(0);
    });
  });
};
