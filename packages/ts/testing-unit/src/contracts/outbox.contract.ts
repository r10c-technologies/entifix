import {
  type DomainEvent,
  ProtocolFailure,
  type StoreFailure,
  Unavailable,
} from '@entifix/core';
import {
  discardIfStale,
  type EventBus,
  type Outbox,
  type OutboxEvent,
} from '@entifix/transactions';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

/** What a case needs from an outbox implementation: the port, and its relay's drain. */
export interface OutboxUnderTest {
  readonly outbox: Outbox;
  /** One relay pass over `outbox`, publishing through `bus`. */
  readonly drain: (
    bus: EventBus,
    maxAttempts: number,
  ) => Effect.Effect<number, unknown>;
}

let clock = 0;
const event = (aggregate: string, version: number): OutboxEvent => {
  clock += 1;
  return {
    name: 'contract.changed',
    id: `${aggregate}:${String(version)}`,
    source: 'contract',
    at: new Date(Date.UTC(2026, 0, 1, 0, 0, clock)).toISOString(),
    aggregate: { type: 'contract', id: aggregate },
    version,
    data: {},
  };
};

/**
 * A bus that records what it published and refuses the ids it is told to —
 * by default as an entry it can never publish, which is what the attempts and
 * the quarantine are for.
 */
const recordingBus = (
  refuse: ReadonlySet<string> = new Set(),
  failure: StoreFailure = new ProtocolFailure({ reason: 'unencodable' }),
) => {
  const published: DomainEvent[] = [];
  const bus: EventBus = {
    publish: published_ =>
      refuse.has(published_.id)
        ? Effect.fail(failure)
        : Effect.sync(() => {
            published.push(published_);
          }),
    /* v8 ignore next -- the relay only publishes; the bus port asks for both. */
    subscribe: () => Effect.void,
  };
  return { bus, published };
};

/**
 * What every {@link Outbox} and its relay must guarantee
 * ([ADR 0018](../../../../../docs/adr/0018-one-outbox-ordered-per-aggregate.md)):
 * a duplicate enqueue is recognised, each aggregate publishes in version
 * order, a failing aggregate holds back only itself, a poisoned one is
 * quarantined without blocking another, a bus outage spends no attempt, and a
 * consumer discards a stale version.
 */
export const describeOutboxContract = (
  name: string,
  make: () => Effect.Effect<OutboxUnderTest, unknown>,
): void => {
  const run = <A, E>(effect: Effect.Effect<A, E>) => Effect.runPromise(effect);

  describe(`Outbox contract: ${name}`, () => {
    it('recognises a duplicate enqueue by event id', async () => {
      const { outbox } = await run(make());
      const first = event('a', 1);

      expect(await run(outbox.enqueue(first))).toBe('enqueued');
      expect(await run(outbox.enqueue(first))).toBe('duplicate');
    });

    it('publishes each aggregate in version order', async () => {
      const { outbox, drain } = await run(make());
      for (const entry of [event('a', 1), event('b', 1), event('a', 2)])
        await run(outbox.enqueue(entry));
      const { bus, published } = recordingBus();

      expect(await run(drain(bus, 3))).toBe(3);
      expect(
        published.filter(e => e.aggregate?.id === 'a').map(e => e.version),
      ).toEqual([1, 2]);
      expect((await run(outbox.stats())).pending).toBe(0);
    });

    // The record's point: a failing head holds back its own aggregate only.
    it('holds back only the aggregate whose head failed', async () => {
      const { outbox, drain } = await run(make());
      for (const entry of [event('a', 1), event('a', 2), event('b', 1)])
        await run(outbox.enqueue(entry));
      const { bus, published } = recordingBus(new Set(['a:1']));

      await run(drain(bus, 3));

      expect(published.map(e => e.id)).toEqual(['b:1']);
      expect((await run(outbox.stats())).pending).toBe(2);
    });

    it('quarantines a poisoned aggregate without blocking another', async () => {
      const { outbox, drain } = await run(make());
      for (const entry of [event('a', 1), event('b', 1), event('a', 2)])
        await run(outbox.enqueue(entry));
      const { bus, published } = recordingBus(new Set(['a:1']));

      await run(drain(bus, 1));

      expect(published.map(e => e.id)).toEqual(['b:1', 'a:2']);
      expect(await run(outbox.stats())).toMatchObject({
        pending: 0,
        quarantined: 1,
      });
    });

    // entifix #330: an outage is not the entry's fault, however long it lasts.
    it('spends no attempt while the bus is down, and publishes once it is back', async () => {
      const { outbox, drain } = await run(make());
      await run(outbox.enqueue(event('a', 1)));
      const down = recordingBus(
        new Set(['a:1']),
        new Unavailable({ dependency: 'contract-bus' }),
      );

      for (let pass = 0; pass < 3; pass += 1) await run(drain(down.bus, 1));
      expect(await run(outbox.stats())).toMatchObject({
        pending: 1,
        quarantined: 0,
      });

      const back = recordingBus();
      expect(await run(drain(back.bus, 1))).toBe(1);
      expect(back.published.map(e => e.id)).toEqual(['a:1']);
    });

    it('lets a consumer discard a version it already applied', async () => {
      const apply = Effect.succeed('applied' as const);

      expect(await run(discardIfStale(Effect.succeed(2), 1, apply))).toBe(
        'stale',
      );
      expect(await run(discardIfStale(Effect.succeed(2), 2, apply))).toBe(
        'stale',
      );
      expect(await run(discardIfStale(Effect.succeed(2), 3, apply))).toBe(
        'applied',
      );
      expect(
        await run(discardIfStale(Effect.succeed(undefined), 1, apply)),
      ).toBe('applied');
    });
  });
};
