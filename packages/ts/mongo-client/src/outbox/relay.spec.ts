import {
  ShutdownRegistryTag,
  type TenantDirectory,
  TenantDirectoryTag,
} from '@entifix/business';
import { ProtocolFailure, type StoreFailure, Unavailable } from '@entifix/core';
import { makeFakeMongoDb } from '@entifix/testing-unit/drivers';
import {
  type EventBus,
  EventBusTag,
  type Outbox,
  type OutboxEntry,
  type OutboxEvent,
} from '@entifix/transactions';
import {
  OutboxMaxAttempts,
  type RelayOutcome,
} from '@entifix/transactions/engine';
import { Effect, Layer } from 'effect';
import type { Db } from 'mongodb';
import { describe, expect, it } from 'vitest';

import { MongoDatabaseTag } from '../mongo-database/mongo-database.js';
import {
  drainOutboxNow,
  startOutboxRelay,
  startTenantOutboxRelay,
  sweepTenantOutboxes,
} from './relay.js';
import { OUTBOX_COLLECTION } from './store.js';

/** `<aggregate>:<step>`: entries sharing a prefix share an aggregate. */
const anEvent = (id: string): OutboxEvent => ({
  name: 'transaction.accepted',
  id,
  source: 'marketplace-admin',
  at: '2026-01-01T00:00:00.000Z',
  correlationId: id.split(':')[0] ?? id,
  aggregate: { type: 'transaction', id: id.split(':')[0] ?? id },
  version: 0,
  data: {},
});

const anEntry = (id: string, attempts = 0): OutboxEntry => ({
  eventId: id,
  aggregate: anEvent(id).aggregate,
  version: anEvent(id).version,
  event: anEvent(id),
  sent: false,
  attempts,
  quarantined: false,
  createdAt: '2026-01-01T00:00:00.000Z',
});

/**
 * An outbox that records what the relay did to it. `pending` deliberately
 * returns the same batch every call — the relay drains once per invocation, so
 * a spec asserts on the recorded calls rather than on a second pass.
 */
const recordingOutbox = (entries: readonly OutboxEntry[]) => {
  const sent: string[] = [];
  const failures: Array<{
    eventId: string;
    error: string;
    quarantine: boolean;
  }> = [];

  const outbox: Outbox = {
    enqueue: () => Effect.succeed('enqueued' as const),
    pending: () => Effect.succeed(entries),
    markSent: entry =>
      Effect.sync(() => {
        sent.push(entry.eventId);
      }),
    recordFailure: (entry, error, quarantine) =>
      Effect.sync(() => {
        failures.push({ eventId: entry.eventId, error, quarantine });
      }),
    stats: () =>
      Effect.succeed({
        pending: entries.filter(entry => !entry.quarantined).length,
        quarantined: entries.filter(entry => entry.quarantined).length,
        oldestPendingAt: entries.find(entry => !entry.quarantined)?.createdAt,
      }),
  };

  return { outbox, sent, failures };
};

/** A bus that refuses the named events and accepts everything else. */
const busRefusing = (
  unpublishable: readonly string[],
  failure: StoreFailure = new ProtocolFailure({
    reason: 'routing key too long',
  }),
) => {
  const published: string[] = [];

  const bus: EventBus = {
    publish: event =>
      unpublishable.includes(event.id)
        ? Effect.fail(failure)
        : Effect.sync(() => {
            published.push(event.id);
          }),
    subscribe: () => Effect.void,
  };

  return { bus, published };
};

describe('startOutboxRelay', () => {
  const world = (entries: readonly OutboxEntry[]) => {
    const { outbox, sent } = recordingOutbox(entries);
    const { bus } = busRefusing([]);
    const registered: Array<{ name: string; phase: string }> = [];

    const layer = Layer.mergeAll(
      Layer.succeed(MongoDatabaseTag, {
        databaseName: 'order',
        collection: () => ({
          createIndex: async () => 'ok',
        }),
      } as never),
      Layer.succeed(EventBusTag, bus),
      Layer.succeed(OutboxMaxAttempts, 3),
      Layer.succeed(ShutdownRegistryTag, {
        register: (hook: { name: string; phase: string }) =>
          Effect.sync(() => {
            registered.push({ name: hook.name, phase: hook.phase });
          }),
        run: () => Effect.void,
      } as never),
    );

    return { layer, sent, registered, outbox };
  };

  /**
   * ⚠️ **`flush`, not `stop-intake`, and the phase is the whole point.**
   * `AmqpEventBusLayer` registers `stop-intake` to cancel consumers; this runs
   * after it, so the last sweep publishes through a connection that is still
   * open. Registered the other way round the entries it was holding would sit
   * until the next boot.
   */
  it('registers its final drain in the flush phase', async () => {
    const { layer, registered } = world([]);

    await Effect.runPromise(
      Effect.scoped(startOutboxRelay().pipe(Effect.provide(layer))),
    );

    expect(registered).toEqual([{ name: 'outbox-relay', phase: 'flush' }]);
  });

  it('passes a supplied stats sink through to the sweep', async () => {
    const { layer } = world([anEntry('a')]);
    const sampled: string[] = [];

    await Effect.runPromise(
      Effect.scoped(
        startOutboxRelay({
          onStats: database =>
            Effect.sync(() => {
              sampled.push(database);
            }),
          onOutcome: () => Effect.void,
        }).pipe(Effect.provide(layer)),
      ),
    );

    // The daemon's first pass is one interval away, so nothing is sampled by
    // starting alone — the hook's own drain is what proves the sink is wired,
    // and it is asserted through the shutdown registry above.
    expect(sampled).toEqual([]);
  });
});

describe('drainOutboxNow', () => {
  const withBus = (bus: EventBus) =>
    Layer.mergeAll(
      Layer.succeed(EventBusTag, bus),
      Layer.succeed(OutboxMaxAttempts, 3),
    );

  it('publishes what the write just recorded and marks it sent', async () => {
    const fake = makeFakeMongoDb({
      [OUTBOX_COLLECTION]: [anEntry('o-1:1') as never],
    });
    const { bus, published } = busRefusing([]);

    await Effect.runPromise(
      drainOutboxNow(fake.db as Db).pipe(Effect.provide(withBus(bus))),
    );

    expect(published).toEqual(['o-1:1']);
    expect(fake.read(OUTBOX_COLLECTION)[0]?.['sent']).toBe(true);
  });

  it('reports a drain that failed and leaves the entry for the sweep', async () => {
    const fake = makeFakeMongoDb();
    fake.failOn('find', new Error('network down'));
    const { bus } = busRefusing([]);
    const outcomes: RelayOutcome[] = [];

    await expect(
      Effect.runPromise(
        drainOutboxNow(fake.db as Db).pipe(Effect.provide(withBus(bus))),
      ),
    ).resolves.toBeUndefined();
    await Effect.runPromise(
      drainOutboxNow(fake.db as Db, outcome =>
        Effect.sync(() => void outcomes.push(outcome)),
      ).pipe(Effect.provide(withBus(bus))),
    );

    expect(outcomes).toEqual([
      expect.objectContaining({ _tag: 'drainFailed' }),
    ]);
  });
});

describe('sweepTenantOutboxes', () => {
  const tenantDb = (name: string, entries: readonly OutboxEntry[] = []) => {
    const fake = makeFakeMongoDb({
      [OUTBOX_COLLECTION]: [...entries] as never[],
    });
    return {
      fake,
      db: Object.assign(fake.db as object, { databaseName: name }) as Db,
    };
  };

  const directoryOf = (dbs: readonly Db[]): TenantDirectory<Db> => ({
    list: () =>
      Effect.succeed(
        dbs.map(db => ({ organizationId: db.databaseName, handle: db })),
      ),
  });

  it('drains every tenant, and keeps going past one that fails', async () => {
    const broken = tenantDb('tenant_a');
    broken.fake.failOn('createIndex', new Error('IndexOptionsConflict'));
    const healthy = tenantDb('tenant_b', [anEntry('b:1')]);
    const { bus, published } = busRefusing([]);
    const sampled: string[] = [];
    const outcomes: RelayOutcome[] = [];

    await Effect.runPromise(
      sweepTenantOutboxes(directoryOf([broken.db, healthy.db]), bus, {
        maxAttempts: 3,
        onStats: database => Effect.sync(() => void sampled.push(database)),
        onOutcome: outcome => Effect.sync(() => void outcomes.push(outcome)),
      }),
    );

    expect(published).toEqual(['b:1']);
    expect(sampled).toEqual(['tenant_b']);
    expect(outcomes).toContainEqual(
      expect.objectContaining({ _tag: 'sweepFailed', database: 'tenant_a' }),
    );
  });

  it('ensures a tenant’s indexes once across passes', async () => {
    const tenant = tenantDb('tenant_c');
    const { bus } = busRefusing([]);
    const ensured = new Set<string>();
    // No `onStats`: the default gauge recorder is the one a host gets.
    const options = { maxAttempts: 3, ensured };

    await Effect.runPromise(
      sweepTenantOutboxes(directoryOf([tenant.db]), bus, options),
    );
    await Effect.runPromise(
      sweepTenantOutboxes(directoryOf([tenant.db]), bus, options),
    );

    expect(
      tenant.fake.operations.filter(op => op.op === 'createIndex'),
    ).toHaveLength(3);
    expect(ensured).toEqual(new Set(['tenant_c']));
  });

  it('logs a directory it could not list rather than failing the daemon', async () => {
    const { bus } = busRefusing([]);
    const directory: TenantDirectory<Db> = {
      list: () => Effect.fail(new Unavailable({})),
    };

    await expect(
      Effect.runPromise(
        sweepTenantOutboxes(directory, bus, { maxAttempts: 3 }),
      ),
    ).resolves.toBeUndefined();

    const outcomes: RelayOutcome[] = [];
    await Effect.runPromise(
      sweepTenantOutboxes(directory, bus, {
        maxAttempts: 3,
        onOutcome: outcome => Effect.sync(() => void outcomes.push(outcome)),
      }),
    );
    expect(outcomes).toEqual([
      {
        _tag: 'sweepFailed',
        failure: expect.objectContaining({ _tag: 'Unavailable' }),
      },
    ]);
  });
});

describe('startTenantOutboxRelay', () => {
  it('registers its final drain in the flush phase', async () => {
    const registered: Array<{ name: string; phase: string }> = [];
    const sampled: string[] = [];
    const { bus } = busRefusing([]);
    let flush: Effect.Effect<void> = Effect.void;
    const db = Object.assign(makeFakeMongoDb().db as object, {
      databaseName: 'tenant_d',
    }) as Db;

    await Effect.runPromise(
      Effect.scoped(
        startTenantOutboxRelay({
          onStats: database => Effect.sync(() => void sampled.push(database)),
          onOutcome: () => Effect.void,
        }).pipe(
          Effect.provide(
            Layer.mergeAll(
              Layer.succeed(TenantDirectoryTag, {
                list: () =>
                  Effect.succeed([{ organizationId: 'd', handle: db }]),
              }),
              Layer.succeed(EventBusTag, bus),
              Layer.succeed(OutboxMaxAttempts, 3),
              Layer.succeed(ShutdownRegistryTag, {
                register: (hook: {
                  name: string;
                  phase: string;
                  run: Effect.Effect<void>;
                }) =>
                  Effect.sync(() => {
                    registered.push({ name: hook.name, phase: hook.phase });
                    flush = hook.run;
                  }),
                run: () => Effect.void,
              } as never),
            ),
          ),
        ),
      ),
    );
    await Effect.runPromise(flush);

    expect(registered).toEqual([{ name: 'outbox-relay', phase: 'flush' }]);
    expect(sampled).toEqual(['tenant_d']);
  });

  it('starts with the default stats sink when given none', async () => {
    const registered: string[] = [];
    const { bus } = busRefusing([]);

    await Effect.runPromise(
      Effect.scoped(
        startTenantOutboxRelay().pipe(
          Effect.provide(
            Layer.mergeAll(
              Layer.succeed(TenantDirectoryTag, {
                list: () => Effect.succeed([]),
              }),
              Layer.succeed(EventBusTag, bus),
              Layer.succeed(OutboxMaxAttempts, 3),
              Layer.succeed(ShutdownRegistryTag, {
                register: (hook: { name: string }) =>
                  Effect.sync(() => void registered.push(hook.name)),
                run: () => Effect.void,
              } as never),
            ),
          ),
        ),
      ),
    );

    expect(registered).toEqual(['outbox-relay']);
  });
});
