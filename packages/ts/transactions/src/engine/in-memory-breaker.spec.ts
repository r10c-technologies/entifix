import {
  Declined,
  Overloaded,
  ProtocolFailure,
  Unavailable,
} from '@entifix/core';
import { Deferred, Effect, Fiber } from 'effect';
import { describe, expect, it } from 'vitest';

import { BulkheadFull, BulkheadTag } from '../ports/bulkhead.js';
import { BreakerOpen, CircuitBreakerTag } from '../ports/circuit-breaker.js';
import { makeInMemoryBulkhead } from './in-memory-bulkhead.js';
import { InMemoryBulkheadLayer } from './in-memory-bulkhead.js';
import {
  InMemoryCircuitBreakerLayer,
  makeInMemoryCircuitBreaker,
} from './in-memory-circuit-breaker.js';

const DIALS = {
  windowType: 'count',
  windowSize: 4,
  failureRateThreshold: 0.5,
  slowCallRateThreshold: 1,
  slowCallDurationMs: 100,
  minimumCalls: 4,
  waitInOpenMs: 1_000,
  halfOpenPermits: 2,
} as const;

const run = <A, E>(effect: Effect.Effect<A, E>) => Effect.runPromise(effect);
const down = Effect.fail(new Unavailable({ dependency: 'stock' }));
const fine = Effect.succeed('ok');

const subject = () => {
  let time = 0;
  const breaker = makeInMemoryCircuitBreaker({ dials: DIALS, now: () => time });
  const call = (effect: Effect.Effect<unknown, unknown>) =>
    run(Effect.exit(breaker.guard('stock')(effect)));
  return {
    breaker,
    call,
    advance: (ms: number) => {
      time += ms;
    },
    state: () => run(breaker.state('stock')),
  };
};

describe('the in-memory circuit breaker', () => {
  it('opens at the failure rate, not before the minimum', async () => {
    const { call, state } = subject();
    await call(fine);
    await call(fine);
    await call(down);
    expect(await state()).toBe('closed');
    await call(down);
    expect(await state()).toBe('open');
    expect((await call(fine))._tag).toBe('Failure');
  });

  it('opens on slow calls', async () => {
    const { call, state, advance } = subject();
    for (let index = 0; index < 4; index += 1)
      await call(Effect.sync(() => advance(150)));
    expect(await state()).toBe('open');
  });

  it('half-opens after its wait, and closes or reopens on its probes', async () => {
    const closing = subject();
    for (let index = 0; index < 4; index += 1) await closing.call(down);
    closing.advance(1_000);
    expect(await closing.state()).toBe('halfOpen');
    await closing.call(fine);
    expect(await closing.state()).toBe('halfOpen');
    await closing.call(fine);
    expect(await closing.state()).toBe('closed');

    const reopening = subject();
    for (let index = 0; index < 4; index += 1) await reopening.call(down);
    reopening.advance(1_000);
    await reopening.call(down);
    await reopening.call(fine);
    expect(await reopening.state()).toBe('open');
  });

  it('admits no more half-open probes than its permits', async () => {
    const { breaker, call, advance } = subject();
    for (let index = 0; index < 4; index += 1) await call(down);
    advance(1_000);
    const probes = [
      Effect.runFork(breaker.guard('stock')(Effect.never)),
      Effect.runFork(breaker.guard('stock')(Effect.never)),
    ];
    await new Promise(resolve => setTimeout(resolve, 0));

    expect((await call(fine))._tag).toBe('Failure');
    for (const probe of probes) await run(Fiber.interrupt(probe));
  });

  it('opens at once on Retry-After, for as long as was asked', async () => {
    const { call, state, advance } = subject();
    await call(Effect.fail(new Overloaded({ retryAfterSeconds: 5 })));
    expect(await state()).toBe('open');
    advance(4_999);
    expect(await state()).toBe('open');
    advance(1);
    expect(await state()).toBe('halfOpen');
  });

  it('is not moved by an answer, a protocol failure or a defect', async () => {
    const { call, state } = subject();
    for (let index = 0; index < 4; index += 1) {
      await call(Effect.fail(new Declined({})));
      await call(Effect.fail(new ProtocolFailure({ reason: 'x' })));
      await call(Effect.die('bug'));
      await call(Effect.fail(new Error('untyped')));
    }
    expect(await state()).toBe('closed');
  });

  it('does not record a call that ends after an operator forced the breaker open', async () => {
    const { breaker, state } = subject();
    const release = await run(Deferred.make<void, Unavailable>());
    const inFlight = Effect.runFork(
      Effect.exit(breaker.guard('stock')(Deferred.await(release))),
    );
    await new Promise(resolve => setTimeout(resolve, 0));

    await run(breaker.force('stock', 'forcedOpen'));
    await run(Deferred.fail(release, new Unavailable({})));
    await run(Fiber.join(inFlight));

    expect(await state()).toBe('forcedOpen');
  });

  it('obeys an operator, and ignores Retry-After while disabled', async () => {
    const { breaker, call, state } = subject();
    await run(breaker.force('stock', 'forcedOpen'));
    expect((await call(fine))._tag).toBe('Failure');
    await run(breaker.force('stock', 'disabled'));
    await call(Effect.fail(new Overloaded({ retryAfterSeconds: 5 })));
    for (let index = 0; index < 8; index += 1) await call(down);
    expect(await state()).toBe('disabled');
    await run(breaker.force('stock', 'closed'));
    expect((await call(fine))._tag).toBe('Success');
  });
});

describe('the in-memory bulkhead', () => {
  it('refuses past its permits and frees a permit however a call ends', async () => {
    const bulkhead = makeInMemoryBulkhead({ permits: 1 });
    const held = Effect.runFork(bulkhead.withPermit('stock')(Effect.never));
    await new Promise(resolve => setTimeout(resolve, 0));

    expect(await run(bulkhead.inUse('stock'))).toBe(1);
    expect(
      (await run(Effect.exit(bulkhead.withPermit('stock')(Effect.void))))._tag,
    ).toBe('Failure');
    await run(Fiber.interrupt(held));
    await run(Effect.exit(bulkhead.withPermit('stock')(down)));
    expect(await run(bulkhead.inUse('stock'))).toBe(0);
  });
});

describe('the in-memory engines', () => {
  it('take a key’s own dials over the shared ones', async () => {
    const breaker = makeInMemoryCircuitBreaker({
      dials: { minimumCalls: 100 },
      dialsFor: key => (key === 'payment' ? { minimumCalls: 1 } : undefined),
    });

    await run(Effect.exit(breaker.guard('stock')(down)));
    await run(Effect.exit(breaker.guard('payment')(down)));
    expect(await run(breaker.state('stock'))).toBe('closed');
    expect(await run(breaker.state('payment'))).toBe('open');
  });

  it('count a time window, and forget calls older than it', async () => {
    let time = 0;
    const breaker = makeInMemoryCircuitBreaker({
      dials: { windowType: 'time', windowSize: 1, minimumCalls: 2 },
      now: () => time,
    });
    const down = Effect.fail(new Unavailable({}));

    await Effect.runPromise(Effect.exit(breaker.guard('stock')(down)));
    time += 2_000;
    await Effect.runPromise(Effect.exit(breaker.guard('stock')(down)));
    expect(await Effect.runPromise(breaker.state('stock'))).toBe('closed');
    await Effect.runPromise(Effect.exit(breaker.guard('stock')(down)));
    expect(await Effect.runPromise(breaker.state('stock'))).toBe('open');
  });

  it('take a key’s own permits, and default to ten', async () => {
    const bulkhead = makeInMemoryBulkhead({
      permitsFor: key => (key === 'payment' ? 1 : undefined),
    });
    const held = Effect.runFork(bulkhead.withPermit('payment')(Effect.never));
    await new Promise(resolve => setTimeout(resolve, 0));

    const refused = await Effect.runPromise(
      Effect.exit(bulkhead.withPermit('payment')(Effect.void)),
    );
    const other = await Effect.runPromise(
      Effect.exit(bulkhead.withPermit('stock')(Effect.void)),
    );
    expect(refused._tag).toBe('Failure');
    expect(other._tag).toBe('Success');
    held.interruptUnsafe();
  });

  it('are provided by their layers', async () => {
    const both = await Effect.runPromise(
      Effect.all([CircuitBreakerTag, BulkheadTag]).pipe(
        Effect.provide(InMemoryCircuitBreakerLayer()),
        Effect.provide(InMemoryBulkheadLayer()),
      ),
    );

    expect(both).toHaveLength(2);
  });
});

describe('the failures', () => {
  it('say which dependency refused, for a reader', () => {
    expect(new BreakerOpen({ dependency: 'stock' }).message).toContain(
      "'stock'",
    );
    expect(new BulkheadFull({ dependency: 'stock' }).message).toContain(
      "'stock'",
    );
  });
});
