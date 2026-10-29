import type { BoundSubscription, WiringRegistry } from '@entifix/business';
import {
  makeShutdownRegistry,
  ShutdownRegistryTag,
  WiringRegistryTag,
} from '@entifix/business';
import type { DomainEvent } from '@entifix/core';
import { Invalid, ProtocolFailure, Unavailable } from '@entifix/core';
import { describeEventBusContract } from '@entifix/testing-unit/contracts';
import { makeFakeAmqpChannel } from '@entifix/testing-unit/drivers';
import { EventBusTag, type Subscription } from '@entifix/transactions';
import { makeInMemoryCircuitBreaker } from '@entifix/transactions/engine';
import type { Channel } from 'amqplib';
import { Duration, Effect, Exit, Layer, Metric } from 'effect';
import { describe, expect, it } from 'vitest';

import type { AmqpConnector } from '../amqp-connection/amqp-connection.js';
import {
  AmqpChannelTag,
  EVENTS_DLX,
} from '../amqp-connection/amqp-connection.js';
import {
  AmqpEventBusLayer,
  ATTEMPTS_HEADER,
  DEFAULT_REDELIVERY_BACKOFF,
  exponentialRedeliveryBackoff,
  makeAmqpEventBus,
  queueNameFor,
  RedeliveryBackoffTag,
} from './amqp-event-bus.js';
import { busEventsQuarantined } from './bus-metrics.js';

/**
 * A connector that always hands back the same fake channel. The bus asks for a
 * channel per call now (a held one does not survive a broker restart), so the
 * doubles have to supply that indirection — the reconnect behaviour itself is
 * covered in `amqp-connection.spec.ts`.
 */
const connectorFor = (channel: Channel): AmqpConnector => ({
  withChannel: use => use(channel),
  addConsumer: async setup => {
    await setup(channel, {
      replaceTags: () => undefined,
      cancelled: () => false,
    });
  },
  cancelConsumers: async () => undefined,
});

/** What the tracker binds, and what the contract harness subscribes with. */
const ANY_TRANSACTION = 'transaction.*';

/** The tracker's own subscription: a durable queue it must not lose events from. */
const WORK: Subscription = {
  slice: 'transaction',
  pattern: ANY_TRANSACTION,
  mode: 'work',
  maxAttempts: 5,
};

/** The same interest, shaped for a consumer every replica must receive. */
const BROADCAST: Subscription = { ...WORK, mode: 'broadcast' };

/** What `WORK` resolves to, spelled once so the expectations agree. */
const WORK_QUEUE = 'transaction.transaction._star_';

const anEvent = (id = 'tx-1:accepted'): DomainEvent => ({
  name: 'transaction.accepted',
  id,
  source: 'marketplace-admin',
  at: '2026-01-01T00:00:00.000Z',
  correlationId: 'tx-1',
  data: {
    transactionId: 'tx-1',
    entity: 'product',
    state: 'PENDING',
    step: 'accepted',
    at: '2026-01-01T00:00:00.000Z',
  },
});

/** The envelope the adapter puts on the wire for `event`. */
const anEnvelope = (event: DomainEvent) => {
  const { data, ...meta } = event;
  return { meta: { type: 'event', event: meta }, data };
};

/**
 * A wiring registry that just remembers, so a case can assert what the adapter
 * recorded without standing up the real `Ref`-backed layer.
 */
const recordingWiring = () => {
  const subscriptions: BoundSubscription[] = [];
  const published: string[] = [];
  const registry: WiringRegistry = {
    recordSubscription: bound =>
      Effect.sync(() => {
        subscriptions.push(bound);
      }),
    recordPublish: name =>
      Effect.sync(() => {
        published.push(name);
      }),
    subscriptions: Effect.sync(() => subscriptions),
    published: Effect.sync(() => published),
  };
  return { registry, subscriptions, published };
};

/**
 * The bus runs against a fake amqplib channel, so the envelope framing, the
 * `prefetch(1)`, and the ack/nack policy are the real adapter's.
 */
const withFakeChannel = () => {
  const fake = makeFakeAmqpChannel();
  const wiring = recordingWiring();
  return {
    fake,
    wiring,
    ...makeAmqpEventBus(
      connectorFor(fake.channel as Channel),
      wiring.registry,
      {
        // No wait between attempts, so a spec settles in one tick.
        redeliveryBackoff: () => Duration.zero,
      },
    ),
  };
};

describeEventBusContract('amqp adapter over a fake channel', async () => {
  const { fake, bus } = withFakeChannel();
  // Subscribers are registered lazily by the contract; publishing goes out as
  // an envelope, so `published` unwraps it back into the event. The fake routes
  // by the binding, so the contract's non-matching case exercises the real
  // `bindQueue` pattern rather than a stub that fans out to everyone.
  return {
    bus,
    deliver: event => fake.deliver(anEnvelope(event)),
    published: () =>
      fake.published.map(message => {
        const body = message.body as {
          meta: { event: Omit<DomainEvent, 'data'> };
          data: unknown;
        };
        return { ...body.meta.event, data: body.data };
      }),
  };
});

describe('makeAmqpEventBus', () => {
  it('frames events as event envelopes, splitting metadata from payload', async () => {
    const { fake, bus } = withFakeChannel();

    await Effect.runPromise(bus.publish(anEvent()));

    expect(fake.published[0]?.body).toEqual(anEnvelope(anEvent()));
  });

  // The routing key is the whole point of the topic exchange: it is what lets a
  // subscriber declare its interest to the broker instead of filtering in its
  // own handler.
  it('publishes under the event’s own name as the routing key', async () => {
    const { fake, bus } = withFakeChannel();

    await Effect.runPromise(bus.publish(anEvent()));

    expect(fake.published[0]?.routingKey).toBe('transaction.accepted');
  });

  it('names a work queue after the subscribing slice and its pattern', () => {
    expect(queueNameFor(WORK)).toBe(WORK_QUEUE);
    // `#` too, because a name a broker accepts is not the same as one that
    // survives being a URL path segment in the management API.
    expect(queueNameFor({ ...WORK, pattern: 'catalog.#' })).toBe(
      'transaction.catalog._hash_',
    );
  });

  it('declares a work queue that outlives the consumer, with a delivery ceiling', async () => {
    const { fake, bus } = withFakeChannel();

    await Effect.runPromise(bus.subscribe(WORK, () => Effect.void));

    // Durable and quorum-backed, so an event published while this consumer is
    // restarting is still there when it comes back — the hop the outbox
    // relay's durability chain was missing. The ceiling is a queue argument, so the
    // broker counts a redelivery after a crash as well as one after a nack.
    expect(fake.queues).toContainEqual({
      queue: WORK_QUEUE,
      options: {
        durable: true,
        arguments: {
          'x-queue-type': 'quorum',
          'x-delivery-limit': 5,
          'x-dead-letter-exchange': 'entifix.events.dlx',
          'x-dead-letter-routing-key': WORK_QUEUE,
        },
      },
    });
  });

  it('declares the quarantine before the queue that dead-letters into it', async () => {
    const { fake, bus } = withFakeChannel();

    await Effect.runPromise(bus.subscribe(WORK, () => Effect.void));

    // Order matters: a `direct` exchange drops what it cannot route, so a
    // message dead-lettered the instant the work queue exists must already
    // have somewhere to land.
    expect(fake.queues.map(queue => queue.queue)).toEqual([
      `${WORK_QUEUE}.quarantine`,
      WORK_QUEUE,
    ]);
    expect(fake.bindings).toEqual([
      {
        queue: `${WORK_QUEUE}.quarantine`,
        exchange: 'entifix.events.dlx',
        pattern: WORK_QUEUE,
      },
      {
        queue: WORK_QUEUE,
        exchange: 'entifix.events',
        pattern: ANY_TRANSACTION,
      },
    ]);
  });

  it('keeps a broadcast subscription on an exclusive queue', async () => {
    const { fake, bus } = withFakeChannel();

    await Effect.runPromise(bus.subscribe(BROADCAST, () => Effect.void));

    // No name, no durability, no dead-letter path: every replica receives
    // every event and nothing is retained. Right only when the replicas
    // genuinely differ, as a per-connection push does.
    expect(fake.queues).toEqual([
      { queue: 'amq.gen-fake', options: { exclusive: true } },
    ]);
    expect(fake.bindings).toEqual([
      {
        queue: 'amq.gen-fake',
        exchange: 'entifix.events',
        pattern: ANY_TRANSACTION,
      },
    ]);
  });

  it('asks for prefetch(1), without which the manager’s fold races', async () => {
    const { fake, bus } = withFakeChannel();

    await Effect.runPromise(bus.subscribe(WORK, () => Effect.void));

    // An accepted/completed pair delivered concurrently would otherwise upsert
    // twice for the same transaction.
    expect(fake.prefetchCount).toBe(1);
  });

  it('acks a message its handler accepted', async () => {
    const { fake, bus } = withFakeChannel();
    await Effect.runPromise(bus.subscribe(WORK, () => Effect.void));

    await fake.deliver(anEnvelope(anEvent()));

    expect(fake.acked).toHaveLength(1);
    expect(fake.nacked).toHaveLength(0);
  });

  /** The copies the adapter puts back on a work queue, with their count. */
  const redelivered = (fake: ReturnType<typeof withFakeChannel>['fake']) =>
    fake.published.filter(entry => entry.exchange === '');

  it('puts a transient handler failure back on its queue, counting the attempt itself', async () => {
    const { fake, bus } = withFakeChannel();
    await Effect.runPromise(
      bus.subscribe(WORK, () =>
        Effect.fail(new Error('handler failed') as never),
      ),
    );

    await fake.deliver(anEnvelope(anEvent()));

    // Not a requeued nack: RabbitMQ 4 does not count one toward
    // `x-delivery-limit`, so the broker would redeliver it forever (#130). The
    // copy carries the count, on the queue's own name through the default
    // exchange, and the original is acked.
    expect(redelivered(fake)).toEqual([
      expect.objectContaining({
        routingKey: WORK_QUEUE,
        headers: { [ATTEMPTS_HEADER]: 1 },
      }),
    ]);
    expect(fake.acked).toHaveLength(1);
    expect(fake.nacked).toHaveLength(0);
  });

  it('quarantines a transient failure once it has spent maxAttempts, with its reason', async () => {
    const { fake, bus } = withFakeChannel();
    await Effect.runPromise(
      bus.subscribe(WORK, () =>
        Effect.fail(new Unavailable({ dependency: 'mongo' }) as never),
      ),
    );

    // Each copy the adapter republishes is what the broker hands back next.
    await fake.deliver(anEnvelope(anEvent()));
    for (let attempt = 1; attempt < WORK.maxAttempts; attempt += 1) {
      const copy = redelivered(fake).at(-1);
      await fake.deliver(copy?.body, undefined, copy?.headers);
    }

    expect(
      redelivered(fake).map(entry => entry.headers?.[ATTEMPTS_HEADER]),
    ).toEqual([1, 2, 3, 4]);
    expect(quarantined(fake)).toEqual([
      expect.objectContaining({
        headers: {
          [ATTEMPTS_HEADER]: WORK.maxAttempts,
          'x-failure-code': 'unavailable',
          'x-failure-category': 'unavailable',
        },
      }),
    ]);
    expect(fake.acked).toHaveLength(WORK.maxAttempts);
    expect(fake.nacked).toHaveLength(0);
  });

  it('falls back to the broker’s requeue when the copy cannot be published', async () => {
    const { fake, bus } = withFakeChannel();
    let calls = 0;
    await Effect.runPromise(
      bus.subscribe(WORK, () =>
        Effect.suspend(() => {
          calls += 1;
          // The channel goes down between the handler failing and the copy
          // being published.
          fake.failWith(new Error('channel closed'));
          return Effect.fail(new Error('handler failed') as never);
        }),
      ),
    );

    await fake.deliver(anEnvelope(anEvent()));

    expect(calls).toBe(1);
    expect(redelivered(fake)).toEqual([]);
    expect(fake.nacked).toEqual([
      { message: expect.anything(), allUpTo: false, requeue: true },
    ]);
  });

  it('waits its backoff before the copy goes back', async () => {
    const fake = makeFakeAmqpChannel();
    const { bus } = makeAmqpEventBus(
      connectorFor(fake.channel as Channel),
      recordingWiring().registry,
      { redeliveryBackoff: () => Duration.millis(20) },
    );
    await Effect.runPromise(
      bus.subscribe(WORK, () =>
        Effect.fail(new Error('handler failed') as never),
      ),
    );

    await fake.deliver(anEnvelope(anEvent()));
    const before = fake.published.length;
    await new Promise(resolve => setTimeout(resolve, 60));

    expect(before).toBe(0);
    expect(fake.published).toHaveLength(1);
  });

  it('backs off doubling from 100 ms, capped at two seconds', () => {
    expect(
      [1, 2, 3, 5, 9].map(attempt =>
        Duration.toMillis(DEFAULT_REDELIVERY_BACKOFF(attempt)),
      ),
    ).toEqual([100, 200, 400, 1_600, 2_000]);
  });

  it('sizes a backoff from its own dials', () => {
    expect(
      [1, 2, 3, 4].map(attempt =>
        Duration.toMillis(
          exponentialRedeliveryBackoff({ baseMs: 50, capMs: 300 })(attempt),
        ),
      ),
    ).toEqual([50, 100, 200, 300]);
  });

  it('counts each quarantine once, by category', async () => {
    const { fake, bus } = withFakeChannel();
    const counted = Metric.withAttributes(busEventsQuarantined, {
      queue: WORK_QUEUE,
      slice: WORK.slice,
      mode: WORK.mode,
      category: 'invalid',
    });
    const before = await Effect.runPromise(
      Metric.value(counted).pipe(Effect.map(state => state.count)),
    );
    await Effect.runPromise(
      bus.subscribe(WORK, () =>
        Effect.fail(new Invalid({ errors: [] }) as never),
      ),
    );

    await fake.deliver(anEnvelope(anEvent()));

    expect(
      await Effect.runPromise(
        Metric.value(counted).pipe(Effect.map(state => state.count)),
      ),
    ).toBe(before + 1);
  });

  /** The quarantine republish a poison message gets, with its reason. */
  const quarantined = (fake: ReturnType<typeof withFakeChannel>['fake']) =>
    fake.published.filter(entry => entry.exchange === EVENTS_DLX);

  it('quarantines a payload its own consumer rejects, with its reason and no retry', async () => {
    // ⚠️ Measured on `catalog.published`, not imagined: a payload the domain
    // contract rejected took five deliveries to reach the quarantine it
    // belonged in immediately.
    //
    // The transport validates `meta` and deliberately **not** `data`, so the
    // consumer's own decoder is the only thing that can tell a malformed
    // payload from a bad afternoon at the database. It says so with a
    // business failure, and an answer never changes on a retry.
    const { fake, bus } = withFakeChannel();
    await Effect.runPromise(
      bus.subscribe(WORK, () =>
        Effect.fail(new Invalid({ errors: [] }) as never),
      ),
    );

    await fake.deliver(anEnvelope(anEvent()));

    expect(quarantined(fake)).toEqual([
      expect.objectContaining({
        routingKey: WORK_QUEUE,
        headers: expect.objectContaining({
          'x-failure-code': 'invalid',
          'x-failure-category': 'invalid',
        }),
      }),
    ]);
    expect(fake.acked).toHaveLength(1);
    expect(fake.nacked).toHaveLength(0);
  });

  it('decides by category on a failure that is no class instance at all', async () => {
    // What a failure decoded off a wire, or defined in a second copy of core,
    // looks like: the facts, and no prototype to `instanceof` against.
    const { fake, bus } = withFakeChannel();
    await Effect.runPromise(
      bus.subscribe(WORK, () =>
        Effect.fail({
          _tag: 'CurrencyMissing',
          code: 'currencyMissing',
          category: 'declined',
          family: 'business',
          message: '',
        } as never),
      ),
    );

    await fake.deliver(anEnvelope(anEvent()));

    expect(quarantined(fake)[0]?.headers).toMatchObject({
      'x-failure-code': 'currencyMissing',
      'x-failure-category': 'declined',
    });
  });

  it('quarantines a protocol failure, which no retry decodes', async () => {
    const { fake, bus } = withFakeChannel();
    await Effect.runPromise(
      bus.subscribe(WORK, () =>
        Effect.fail(new ProtocolFailure({ reason: 'bad shape' }) as never),
      ),
    );

    await fake.deliver(anEnvelope(anEvent()));

    expect(quarantined(fake)).toHaveLength(1);
  });

  it('still requeues an unreachable store, which is exactly what a retry is for', async () => {
    // The other half of the same rule: a Mongo blip must not send a perfectly
    // good message to the quarantine.
    const { fake, bus } = withFakeChannel();
    await Effect.runPromise(
      bus.subscribe(WORK, () =>
        Effect.fail(new Unavailable({ dependency: 'mongo' }) as never),
      ),
    );

    await fake.deliver(anEnvelope(anEvent()));

    expect(redelivered(fake)).toHaveLength(1);
    expect(quarantined(fake)).toHaveLength(0);
  });

  it('quarantines a poison payload without spending a single retry', async () => {
    const { fake, bus } = withFakeChannel();
    await Effect.runPromise(bus.subscribe(WORK, () => Effect.void));

    await fake.deliverRaw(JSON.stringify({ not: 'an envelope' }));

    // A payload that does not decode never becomes readable, so retrying it
    // only spends the budget of the messages behind it.
    expect(quarantined(fake)[0]?.headers).toMatchObject({
      'x-failure-code': 'protocol',
      'x-failure-category': 'protocol',
    });
    expect(fake.nacked).toHaveLength(0);
  });

  // The record's point on the bus: `data` that drifted from its registered
  // schema is poison before any handler runs.
  it('quarantines an event whose data its schema refuses', async () => {
    const { fake, bus } = withFakeChannel();
    let handled = 0;
    await Effect.runPromise(
      bus.subscribe(WORK, () =>
        Effect.sync(() => {
          handled += 1;
        }),
      ),
    );

    await fake.deliverRaw(
      JSON.stringify({ ...anEnvelope(anEvent()), data: { step: 'accepted' } }),
    );

    expect(handled).toBe(0);
    expect(quarantined(fake)[0]?.headers).toMatchObject({
      'x-failure-category': 'protocol',
    });
  });

  it('refuses to publish an event nothing registered', async () => {
    const { bus } = withFakeChannel();

    const exit = await Effect.runPromiseExit(
      bus.publish({ ...anEvent(), name: 'nobody.registered' }),
    );

    expect(Exit.isFailure(exit)).toBe(true);
  });

  it('quarantines a payload that is not even JSON', async () => {
    const { fake, bus } = withFakeChannel();
    await Effect.runPromise(bus.subscribe(WORK, () => Effect.void));

    await fake.deliverRaw('not json at all');

    // `JSON.parse` throws synchronously. Outside the Effect it escaped into
    // amqplib's callback and the message was never settled at all.
    expect(quarantined(fake)).toEqual([
      expect.objectContaining({
        body: 'not json at all',
        headers: expect.objectContaining({
          'x-failure-code': 'invalidEnvelope',
        }),
      }),
    ]);
  });

  it('still quarantines, reasonless, when the republish is refused', async () => {
    const { fake, bus } = withFakeChannel();
    await Effect.runPromise(bus.subscribe(WORK, () => Effect.void));
    fake.failWith(new Error('channel closed'));

    await fake.deliverRaw('not json at all');

    expect(fake.nacked).toEqual([
      { message: expect.anything(), allUpTo: false, requeue: false },
    ]);
  });

  it('does not requeue a broadcast failure, which nothing would ever stop', async () => {
    const { fake, bus } = withFakeChannel();
    await Effect.runPromise(
      bus.subscribe(BROADCAST, () =>
        Effect.fail(new Error('handler failed') as never),
      ),
    );

    await fake.deliver(anEnvelope(anEvent()));

    // An exclusive queue has neither a delivery limit nor a dead-letter
    // exchange, so a requeue there is an unbounded loop rather than a bounded
    // retry. The message is dropped, which is the cost of broadcast semantics
    // and the reason a work consumer must not choose them.
    expect(fake.nacked).toEqual([
      { message: expect.anything(), allUpTo: false, requeue: false },
    ]);
  });

  it('ignores a broker cancellation delivered as a null message', async () => {
    const { fake, bus } = withFakeChannel();
    await Effect.runPromise(bus.subscribe(WORK, () => Effect.void));

    await fake.deliverCancellation();

    expect(fake.acked).toHaveLength(0);
    expect(fake.nacked).toHaveLength(0);
  });

  it('maps a publish failure onto Unavailable', async () => {
    const { fake, bus } = withFakeChannel();
    fake.failWith(new Error('channel closed'));

    const exit = await Effect.runPromiseExit(bus.publish(anEvent()));

    expect(Exit.isFailure(exit)).toBe(true);
  });

  it('maps a subscribe failure onto Unavailable', async () => {
    const { fake, bus } = withFakeChannel();
    fake.failWith(new Error('channel closed'));

    const exit = await Effect.runPromiseExit(
      bus.subscribe(WORK, () => Effect.void),
    );

    expect(Exit.isFailure(exit)).toBe(true);
  });

  /**
   * What the process actually did, recorded where it did it. A source scan
   * cannot see emission, which is how a host's register can declare an event
   * with nothing publishing it.
   */
  it('records the event names it published', async () => {
    const { bus, wiring } = withFakeChannel();

    await Effect.runPromise(bus.publish(anEvent()));

    expect(wiring.published).toEqual(['transaction.accepted']);
  });

  // Recorded after the publish succeeds. Recording the intent instead would let
  // the diff pass for a service whose every publish is failing.
  it('records nothing when the publish fails', async () => {
    const { fake, bus, wiring } = withFakeChannel();
    fake.failWith(new Error('channel closed'));

    await Effect.runPromiseExit(bus.publish(anEvent()));

    expect(wiring.published).toEqual([]);
  });

  it('records the queue a subscription bound, with its mode', async () => {
    const { bus, wiring } = withFakeChannel();

    await Effect.runPromise(bus.subscribe(WORK, () => Effect.void));

    expect(wiring.subscriptions).toEqual([
      {
        slice: 'transaction',
        pattern: ANY_TRANSACTION,
        mode: 'work',
        queue: WORK_QUEUE,
      },
    ]);
  });

  // A broadcast queue is named by the broker, so the recorded name is whatever
  // `assertQueue('')` came back with — which is what an operator needs to find
  // it in the management UI.
  it('records the generated name of a broadcast queue', async () => {
    const { bus, wiring } = withFakeChannel();

    await Effect.runPromise(bus.subscribe(BROADCAST, () => Effect.void));

    expect(wiring.subscriptions[0]?.mode).toBe('broadcast');
    expect(wiring.subscriptions[0]?.queue).not.toBe(WORK_QUEUE);
  });
});

describe('AmqpEventBusLayer', () => {
  // The layer takes both tags because the registry it records into has to be the
  // instance `makeServerLayer` provided — a second one would be written to by
  // the bus and read by nobody.
  it('builds a bus from the connector and the wiring registry', async () => {
    const fake = makeFakeAmqpChannel();
    const wiring = recordingWiring();

    await Effect.runPromise(
      Effect.gen(function* () {
        const bus = yield* EventBusTag;
        yield* bus.publish(anEvent());
      }).pipe(
        Effect.provide(
          AmqpEventBusLayer.pipe(
            Layer.provide(
              Layer.mergeAll(
                Layer.succeed(
                  AmqpChannelTag,
                  connectorFor(fake.channel as Channel),
                ),
                Layer.succeed(WiringRegistryTag, wiring.registry),
                Layer.succeed(
                  ShutdownRegistryTag,
                  makeShutdownRegistry().registry,
                ),
              ),
            ),
          ),
        ),
      ),
    );

    expect(wiring.published).toEqual(['transaction.accepted']);
  });

  /** A layer-built bus over `fake`, with `backoff` provided when given. */
  const layerBus = (
    fake: ReturnType<typeof makeFakeAmqpChannel>,
    backoff?: Layer.Layer<RedeliveryBackoffTag>,
  ) =>
    Effect.gen(function* () {
      const bus = yield* EventBusTag;
      yield* bus.subscribe(WORK, () =>
        Effect.fail(new Error('handler failed') as never),
      );
    }).pipe(
      Effect.provide(
        AmqpEventBusLayer.pipe(
          Layer.provide(
            Layer.mergeAll(
              Layer.succeed(
                AmqpChannelTag,
                connectorFor(fake.channel as Channel),
              ),
              Layer.succeed(WiringRegistryTag, recordingWiring().registry),
              Layer.succeed(
                ShutdownRegistryTag,
                makeShutdownRegistry().registry,
              ),
              backoff ?? Layer.empty,
            ),
          ),
        ),
      ),
    );

  // The dials are configuration a host reads at boot, so the layer is the one
  // place they can reach the adapter.
  it('redelivers on the backoff a composition provides', async () => {
    const fake = makeFakeAmqpChannel();
    await Effect.runPromise(
      layerBus(
        fake,
        Layer.succeed(RedeliveryBackoffTag, () => Duration.zero),
      ),
    );

    await fake.deliver(anEnvelope(anEvent()));
    await new Promise(resolve => setTimeout(resolve, 0));

    expect(fake.published).toHaveLength(1);
  });

  it('falls back to the default backoff when none is provided', async () => {
    const fake = makeFakeAmqpChannel();
    await Effect.runPromise(layerBus(fake));

    await fake.deliver(anEnvelope(anEvent()));
    await new Promise(resolve => setTimeout(resolve, 0));
    const before = fake.published.length;
    await new Promise(resolve => setTimeout(resolve, 150));

    expect(before).toBe(0);
    expect(fake.published).toHaveLength(1);
  });

  // The half a cancel does not cover: cancelling stops the broker handing over
  // anything new and says nothing about the delivery already being handled.
  // Without this wait, SIGTERM kills the handler mid-flight and the broker
  // redelivers a message that had all but finished.
  it('waits for an in-flight delivery before the drain completes', async () => {
    const { fake, bus, drainDeliveries } = withFakeChannel();
    let release = () => undefined as void;
    const handled = new Promise<void>(resolve => {
      release = resolve;
    });

    await Effect.runPromise(
      bus.subscribe(WORK, () => Effect.promise(() => handled)),
    );
    // Not awaited: the delivery is deliberately still in flight while the drain
    // runs, which is the state under test.
    void fake.deliver(anEnvelope(anEvent()));
    await new Promise(resolve => setTimeout(resolve, 0));

    let drained = false;
    const draining = Effect.runPromise(drainDeliveries).then(() => {
      drained = true;
    });
    await new Promise(resolve => setTimeout(resolve, 50));
    expect(drained).toBe(false);

    release();
    await draining;

    expect(drained).toBe(true);
    expect(fake.acked).toHaveLength(1);
  });

  it('completes at once when nothing is in flight', async () => {
    const { drainDeliveries } = withFakeChannel();

    await expect(Effect.runPromise(drainDeliveries)).resolves.toBeUndefined();
  });

  // The drain has to be registered by the adapter that owns the deliveries, or
  // every service's composition root grows a shutdown sequence to remember.
  it('registers a stop-intake hook that cancels the consumers', async () => {
    const fake = makeFakeAmqpChannel();
    const wiring = recordingWiring();
    const shutdown = makeShutdownRegistry();
    let cancelled = 0;
    const connector: AmqpConnector = {
      withChannel: use => use(fake.channel as Channel),
      addConsumer: async setup => {
        await setup(fake.channel as Channel, {
          replaceTags: () => undefined,
          cancelled: () => false,
        });
      },
      cancelConsumers: async () => {
        cancelled += 1;
      },
    };

    await Effect.runPromise(
      Effect.gen(function* () {
        yield* EventBusTag;
        yield* shutdown.registry.drain;
      }).pipe(
        Effect.provide(
          AmqpEventBusLayer.pipe(
            Layer.provide(
              Layer.mergeAll(
                Layer.succeed(AmqpChannelTag, connector),
                Layer.succeed(WiringRegistryTag, wiring.registry),
                Layer.succeed(ShutdownRegistryTag, shutdown.registry),
              ),
            ),
          ),
        ),
      ),
    );

    expect(cancelled).toBe(1);
  });
});

describe('a subscription that pauses while a breaker is open', () => {
  const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

  const pausable = (cancelled = () => false) => {
    const fake = makeFakeAmqpChannel();
    const breaker = makeInMemoryCircuitBreaker({ dials: { minimumCalls: 1 } });
    const held: (readonly string[])[] = [];
    const connector: AmqpConnector = {
      withChannel: use => use(fake.channel as Channel),
      addConsumer: async setup => {
        await setup(fake.channel as Channel, {
          replaceTags: tags => held.push(tags),
          cancelled,
        });
      },
      cancelConsumers: async () => undefined,
    };
    const { bus } = makeAmqpEventBus(connector, recordingWiring().registry, {
      breaker,
      pausePoll: Duration.millis(5),
    });
    return { fake, breaker, held, bus };
  };

  it('stops consuming while the breaker is open, and consumes again once it is not', async () => {
    const { fake, breaker, held, bus } = pausable();
    const handled: string[] = [];
    await Effect.runPromise(
      bus.subscribe({ ...WORK, pauseWhileOpen: ['stock'] }, event =>
        Effect.sync(() => {
          handled.push(event.id);
        }),
      ),
    );

    await Effect.runPromise(breaker.force('stock', 'forcedOpen'));
    await sleep(25);
    expect(fake.cancelled).toEqual(['fake-consumer-1']);
    expect(held.at(-1)).toEqual([]);

    await Effect.runPromise(breaker.force('stock', 'closed'));
    await sleep(25);
    expect(held.at(-1)).toEqual(['fake-consumer-2']);
    await fake.deliver(anEnvelope(anEvent('tx-9:accepted')));
    expect(handled).toEqual(['tx-9:accepted']);
    fake.close();
  });

  it('does not resume into a shutdown that stopped intake', async () => {
    let stopped = false;
    const { fake, breaker, held, bus } = pausable(() => stopped);
    await Effect.runPromise(
      bus.subscribe({ ...WORK, pauseWhileOpen: ['stock'] }, () => Effect.void),
    );

    await Effect.runPromise(breaker.force('stock', 'forcedOpen'));
    await sleep(25);
    stopped = true;
    await Effect.runPromise(breaker.force('stock', 'closed'));
    await sleep(25);

    expect(held).toEqual([[]]);
    fake.close();
  });

  it('puts back a delivery an open breaker refused, without counting an attempt', async () => {
    const { fake, breaker, bus } = pausable();
    await Effect.runPromise(breaker.force('stock', 'forcedOpen'));
    await Effect.runPromise(
      bus.subscribe({ ...WORK, pauseWhileOpen: ['stock'] }, () =>
        breaker.guard('stock')(Effect.void),
      ),
    );

    await fake.deliver(anEnvelope(anEvent()), undefined, {
      [ATTEMPTS_HEADER]: 2,
    });

    const republished = fake.published.find(
      entry => entry.exchange === '' && entry.routingKey === WORK_QUEUE,
    );
    expect(republished?.headers?.[ATTEMPTS_HEADER]).toBe(2);
    expect(fake.published.some(entry => entry.exchange === EVENTS_DLX)).toBe(
      false,
    );
    expect(fake.acked).toHaveLength(1);
    fake.close();
  });

  it('requeues through the broker when the copy cannot be put back', async () => {
    const { fake, breaker, bus } = pausable();
    await Effect.runPromise(breaker.force('stock', 'forcedOpen'));
    await Effect.runPromise(
      bus.subscribe({ ...WORK, pauseWhileOpen: ['stock'] }, () =>
        Effect.suspend(() => {
          fake.failWith(new Error('channel closed'));
          return breaker.guard('stock')(Effect.void);
        }),
      ),
    );

    await fake.deliver(anEnvelope(anEvent()));

    expect(fake.nacked).toEqual([
      { message: expect.anything(), allUpTo: false, requeue: true },
    ]);
    fake.close();
  });

  it('stops watching once its channel closes', async () => {
    const { fake, breaker, bus } = pausable();
    await Effect.runPromise(
      bus.subscribe({ ...WORK, pauseWhileOpen: ['stock'] }, () => Effect.void),
    );

    fake.close();
    await Effect.runPromise(breaker.force('stock', 'forcedOpen'));
    await sleep(25);

    expect(fake.cancelled).toEqual([]);
  });
});
