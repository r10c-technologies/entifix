import { makeShutdownRegistry, ShutdownRegistryTag } from '@entifix/business';
import { Contention, Declined, Unavailable } from '@entifix/core';
import { makeFakeSqlClient } from '@entifix/testing-unit/drivers';
import {
  type EventBus,
  EventBusTag,
  type OutboxEvent,
} from '@entifix/transactions';
import {
  OutboxMaxAttempts,
  type RelayOutcome,
} from '@entifix/transactions/engine';
import { Effect, Layer, Option } from 'effect';
import { SqlClient } from 'effect/sql';
import { describe, expect, it } from 'vitest';

import { makeSqlIdempotencyStore } from './idempotency.js';
import { entryOf, makeSqlOutbox, type OutboxRow } from './outbox.js';
import { drainSqlOutboxNow, startSqlOutboxRelay } from './relay.js';
import { ensureSqlTransactionTables } from './schema.js';
import { makeSqlUnitOfWork } from './unit-of-work.js';

const run = <A, E>(effect: Effect.Effect<A, E>) => Effect.runPromise(effect);

const fresh = () => {
  const fake = makeFakeSqlClient();
  return { fake, sql: fake.client as SqlClient.SqlClient };
};

const statements = (fake: ReturnType<typeof makeFakeSqlClient>) =>
  fake.executions.map(({ sql }) => sql.replace(/\s+/g, ' ').trim());

const anEvent = (id: string, version = 1): OutboxEvent => ({
  name: 'spec.changed',
  id,
  source: 'spec',
  at: '2026-01-01T00:00:00.000Z',
  aggregate: { type: 'widget', id: 'w-1' },
  version,
  data: {},
});

const aRow = (id: string, overrides: Partial<OutboxRow> = {}): OutboxRow => ({
  event_id: id,
  aggregate_type: 'widget',
  aggregate_id: 'w-1',
  version: 1,
  event: anEvent(id),
  attempts: 0,
  last_error: null,
  quarantined: false,
  sent: false,
  created_at: new Date('2026-01-01T00:00:00.000Z'),
  ...overrides,
});

describe('ensureSqlTransactionTables', () => {
  it('creates the outbox, its index, the inboxes and the idempotency table', async () => {
    const { fake, sql } = fresh();

    await run(ensureSqlTransactionTables(sql));

    expect(statements(fake).map(text => text.split(' (')[0])).toEqual([
      'CREATE TABLE IF NOT EXISTS entifix_outbox',
      'CREATE INDEX IF NOT EXISTS entifix_outbox_pending ON entifix_outbox',
      'CREATE TABLE IF NOT EXISTS entifix_inbox',
      'CREATE TABLE IF NOT EXISTS entifix_command_inbox',
      'CREATE TABLE IF NOT EXISTS entifix_idempotency',
    ]);
  });

  it('answers a store that is down as unavailable', async () => {
    const { fake, sql } = fresh();
    fake.failWith('connection refused');

    const failure = await run(Effect.flip(ensureSqlTransactionTables(sql)));

    expect(failure).toBeInstanceOf(Unavailable);
  });
});

describe('makeSqlOutbox', () => {
  it('enqueues an event once, and reads a second enqueue as a duplicate', async () => {
    const { fake, sql } = fresh();
    const outbox = makeSqlOutbox(sql);

    fake.respondTo('INSERT INTO entifix_outbox', [{ event_id: 'e-1' }]);
    expect(await run(outbox.enqueue(anEvent('e-1')))).toBe('enqueued');
    fake.respondTo('INSERT INTO entifix_outbox', []);
    expect(await run(outbox.enqueue(anEvent('e-1')))).toBe('duplicate');
  });

  it('claims pending entries with a lease, oldest first and in version order', async () => {
    const { fake, sql } = fresh();
    fake.respondTo('UPDATE entifix_outbox AS t', [
      aRow('e-2', { version: 2, event: JSON.stringify(anEvent('e-2', 2)) }),
      aRow('e-1', { last_error: 'down', created_at: '2026-01-01T00:00:00Z' }),
    ]);

    const entries = await run(
      makeSqlOutbox(sql, { leaseSeconds: 5 }).pending(10),
    );

    expect(entries.map(entry => entry.eventId)).toEqual(['e-1', 'e-2']);
    expect(entries[0]?.lastError).toBe('down');
    expect(entries[1]?.event.version).toBe(2);
    const claim = fake.lastExecution;
    expect(claim?.sql).toContain('FOR UPDATE SKIP LOCKED');
    expect(claim?.sql).toContain('pg_try_advisory_xact_lock');
    expect(claim?.params).toEqual([10, '5 seconds']);
  });

  it('marks an entry sent, and gives a failed entry’s aggregate back', async () => {
    const { fake, sql } = fresh();
    const outbox = makeSqlOutbox(sql);
    const entry = entryOf(aRow('e-1'));

    await run(outbox.markSent(entry));
    await run(outbox.recordFailure(entry, 'down', true));

    expect(statements(fake)).toEqual([
      expect.stringContaining('SET sent = true, lease_until = NULL'),
      expect.stringContaining('SET attempts = attempts + 1'),
      expect.stringContaining('SET lease_until = NULL WHERE aggregate_type'),
    ]);
    expect(fake.executions[1]?.params).toEqual(['down', true, 'e-1']);
  });

  it('counts what is waiting and how old the oldest is', async () => {
    const { fake, sql } = fresh();
    const outbox = makeSqlOutbox(sql);

    fake.respondTo('count(*)', [
      { pending: '2', quarantined: 1, oldest: new Date(0) },
    ]);
    expect(await run(outbox.stats())).toEqual({
      pending: 2,
      quarantined: 1,
      oldestPendingAt: '1970-01-01T00:00:00.000Z',
    });
    fake.respondTo('count(*)', [{ pending: 0, quarantined: 0, oldest: null }]);
    expect(await run(outbox.stats())).toEqual({ pending: 0, quarantined: 0 });
    fake.respondTo('count(*)', []);
    expect(await run(outbox.stats())).toEqual({ pending: 0, quarantined: 0 });
  });

  it('translates a store failure on every operation', async () => {
    const { fake, sql } = fresh();
    const outbox = makeSqlOutbox(sql);
    const entry = entryOf(aRow('e-1'));
    fake.failWith('down');

    for (const operation of [
      outbox.enqueue(anEvent('e-1')),
      outbox.pending(1),
      outbox.markSent(entry),
      outbox.recordFailure(entry, 'x', false),
      outbox.stats(),
    ] as Effect.Effect<unknown, unknown>[])
      expect(await run(Effect.flip(operation))).toBeInstanceOf(Unavailable);
  });
});

describe('makeSqlUnitOfWork', () => {
  it('commits the writes, the events and the claim together', async () => {
    const { fake, sql } = fresh();
    fake.respondTo('INSERT INTO entifix_command_inbox', [
      { command_id: 'c-1' },
    ]);
    fake.respondTo('INSERT INTO entifix_outbox', [{ event_id: 'e-1' }]);

    const outcome = await run(
      makeSqlUnitOfWork(sql).run(
        unit =>
          unit.handle.sql`INSERT INTO widget VALUES (1)`.pipe(
            Effect.tap(() => Effect.sync(() => unit.emit(anEvent('e-1')))),
            Effect.as({ paymentId: 'p-1' }),
          ),
        {
          claim: { kind: 'command', commandId: 'c-1' },
          replay: value => value,
        },
      ),
    );

    expect(outcome).toEqual({ _tag: 'committed', value: { paymentId: 'p-1' } });
    expect(statements(fake)[0]).toBe('BEGIN');
    expect(statements(fake).at(-1)).toBe('COMMIT');
    expect(
      statements(fake).some(text =>
        text.startsWith('UPDATE entifix_command_inbox'),
      ),
    ).toBe(true);
  });

  it('answers a taken event claim as a duplicate, without running the body', async () => {
    const { fake, sql } = fresh();
    fake.respondTo('INSERT INTO entifix_inbox', []);
    let ran = false;

    const outcome = await run(
      makeSqlUnitOfWork(sql).run(
        () =>
          Effect.sync(() => {
            ran = true;
          }),
        { claim: { kind: 'event', consumer: 'spec', eventId: 'm-1' } },
      ),
    );

    expect(outcome).toEqual({ _tag: 'duplicate', replay: Option.none() });
    expect(ran).toBe(false);
    expect(statements(fake).at(-1)).toBe('ROLLBACK');
  });

  it('answers a duplicate command with what the first run remembered', async () => {
    const { fake, sql } = fresh();
    fake.respondTo('INSERT INTO entifix_command_inbox', []);
    fake.respondTo('SELECT replay', [{ replay: '{"paymentId":"p-1"}' }]);

    const outcome = await run(
      makeSqlUnitOfWork(sql).run(() => Effect.succeed('never'), {
        claim: { kind: 'command', commandId: 'c-1' },
      }),
    );

    expect(outcome).toEqual({
      _tag: 'duplicate',
      replay: Option.some({ paymentId: 'p-1' }),
    });
  });

  it('reads a remembered answer outside a unit, parsed or not, and none when absent', async () => {
    const { fake, sql } = fresh();
    const unitOfWork = makeSqlUnitOfWork(sql);

    fake.respondTo('SELECT replay', [{ replay: { paymentId: 'p-2' } }]);
    expect(await run(unitOfWork.replay('c-2'))).toEqual(
      Option.some({ paymentId: 'p-2' }),
    );
    fake.respondTo('SELECT replay', [{ replay: null }]);
    expect(await run(unitOfWork.replay('c-3'))).toEqual(Option.none());
    fake.respondTo('SELECT replay', []);
    expect(await run(unitOfWork.replay('c-4'))).toEqual(Option.none());
    fake.failOn('SELECT replay', 'down');
    expect(await run(Effect.flip(unitOfWork.replay('c-5')))).toBeInstanceOf(
      Unavailable,
    );
  });

  it('reads an event the outbox already holds as a duplicate', async () => {
    const { fake, sql } = fresh();
    fake.respondTo('INSERT INTO entifix_outbox', []);

    const outcome = await run(
      makeSqlUnitOfWork(sql).run(unit =>
        Effect.sync(() => unit.emit(anEvent('e-same'))),
      ),
    );

    expect(outcome._tag).toBe('duplicate');
  });

  it('answers a business failure as aborted and rolls back', async () => {
    const { fake, sql } = fresh();
    const refusal = new Declined({});

    const outcome = await run(
      makeSqlUnitOfWork(sql).run(() => Effect.fail(refusal)),
    );

    expect(outcome).toEqual({ _tag: 'aborted', reason: refusal });
    expect(statements(fake).at(-1)).toBe('ROLLBACK');
  });

  it('surfaces a store failure as an error', async () => {
    const { fake, sql } = fresh();
    fake.failOn('INSERT INTO widget', 'down');

    const failure = await run(
      Effect.flip(
        makeSqlUnitOfWork(sql).run(
          unit => unit.handle.sql`INSERT INTO widget VALUES (1)`,
        ),
      ),
    );

    expect(failure).toBeInstanceOf(Unavailable);
  });

  it('runs the whole unit again on contention, and runs afterCommit once committed', async () => {
    const { sql } = fresh();
    let attempts = 0;
    const after: string[] = [];

    const outcome = await run(
      makeSqlUnitOfWork(sql).run(
        () =>
          Effect.suspend(() => {
            attempts += 1;
            return attempts === 1
              ? Effect.fail(new Contention())
              : Effect.succeed('done');
          }),
        {
          afterCommit: Effect.sync(() => after.push('drained')).pipe(
            Effect.andThen(Effect.fail(new Unavailable({}))),
          ),
        },
      ),
    );

    expect(outcome).toEqual({ _tag: 'committed', value: 'done' });
    expect(attempts).toBe(2);
    expect(after).toEqual(['drained']);
  });
});

describe('makeSqlIdempotencyStore', () => {
  const store = (fake: ReturnType<typeof makeFakeSqlClient>) =>
    makeSqlIdempotencyStore(fake.client as SqlClient.SqlClient, {
      retentionMs: 60_000,
      now: () => 0,
    });

  it('claims a free key, or one whose holder expired, in one statement', async () => {
    const { fake } = fresh();
    fake.respondTo('ON CONFLICT (dedup_key)', [{ dedup_key: 'k' }]);

    expect(await run(store(fake).claim('k', 'f-1'))).toEqual({
      _tag: 'claimed',
    });
    expect(fake.lastExecution?.params).toEqual([
      'k',
      'f-1',
      new Date(60_000),
      new Date(0),
    ]);
  });

  it('shows a duplicate the live record', async () => {
    const { fake } = fresh();
    fake.respondTo('ON CONFLICT (dedup_key)', []);
    fake.respondTo('SELECT * FROM entifix_idempotency', [
      {
        dedup_key: 'k',
        fingerprint: 'f-1',
        state: 'completed',
        response: '{"status":201,"body":"{}"}',
        expires_at: new Date(60_000),
      },
    ]);

    expect(await run(store(fake).claim('k', 'f-2'))).toEqual({
      _tag: 'existing',
      record: {
        dedupKey: 'k',
        fingerprint: 'f-1',
        state: 'completed',
        response: { status: 201, body: '{}' },
        expiresAt: new Date(60_000).toISOString(),
      },
    });
    fake.respondTo('SELECT * FROM entifix_idempotency', [
      {
        dedup_key: 'k',
        fingerprint: 'f-1',
        state: 'inFlight',
        response: null,
        expires_at: '1970-01-01T00:01:00.000Z',
      },
    ]);
    expect(await run(store(fake).claim('k', 'f-2'))).toMatchObject({
      record: { state: 'inFlight' },
    });
    fake.respondTo('SELECT * FROM entifix_idempotency', [
      {
        dedup_key: 'k',
        fingerprint: 'f-1',
        state: 'completed',
        response: { status: 200, body: '' },
        expires_at: new Date(60_000),
      },
    ]);
    expect(await run(store(fake).claim('k', 'f-2'))).toMatchObject({
      record: { response: { status: 200 } },
    });
  });

  it('takes a key released between its two statements', async () => {
    const { fake } = fresh();
    fake.respondTo('ON CONFLICT (dedup_key)', []);

    expect(await run(store(fake).claim('k', 'f-1'))).toEqual({
      _tag: 'claimed',
    });
    expect(statements(fake).at(-1)).toContain(
      "VALUES ($1, $2, 'inFlight', $3)",
    );
  });

  it('completes and releases a key', async () => {
    const { fake } = fresh();

    await run(store(fake).complete('k', { status: 201, body: '{}' }));
    await run(store(fake).release('k'));

    expect(statements(fake)).toEqual([
      expect.stringContaining("SET state = 'completed'"),
      'DELETE FROM entifix_idempotency WHERE dedup_key = $1',
    ]);
  });

  it('translates a store failure', async () => {
    const { fake } = fresh();
    fake.failWith('down');

    for (const operation of [
      store(fake).claim('k', 'f'),
      store(fake).complete('k', { status: 200, body: '' }),
      store(fake).release('k'),
    ] as Effect.Effect<unknown, unknown>[])
      expect(await run(Effect.flip(operation))).toBeInstanceOf(Unavailable);
  });
});

describe('the SQL relay', () => {
  const recordingBus = () => {
    const published: string[] = [];
    const bus: EventBus = {
      publish: event =>
        Effect.sync(() => {
          published.push(event.id);
        }),
      subscribe: () => Effect.void,
    };
    return { bus, published };
  };

  it('ensures its tables and registers its last sweep in the flush phase', async () => {
    const { fake, sql } = fresh();
    const { bus } = recordingBus();
    const hooks: Array<{ name: string; phase: string }> = [];
    const registry = {
      ...makeShutdownRegistry().registry,
      register: (hook: { name: string; phase: string }) =>
        Effect.sync(() => {
          hooks.push(hook);
        }),
    };

    await run(
      startSqlOutboxRelay({
        database: 'workflow',
        onStats: () => Effect.void,
        onOutcome: () => Effect.void,
      }).pipe(
        Effect.provide(
          Layer.mergeAll(
            Layer.succeed(SqlClient.SqlClient, sql),
            Layer.succeed(EventBusTag, bus),
            Layer.succeed(OutboxMaxAttempts, 3),
            Layer.succeed(ShutdownRegistryTag, registry as never),
          ),
        ),
      ),
    );
    await run(
      startSqlOutboxRelay({ database: 'workflow' }).pipe(
        Effect.provide(
          Layer.mergeAll(
            Layer.succeed(SqlClient.SqlClient, sql),
            Layer.succeed(EventBusTag, bus),
            Layer.succeed(OutboxMaxAttempts, 3),
            Layer.succeed(ShutdownRegistryTag, registry as never),
          ),
        ),
      ),
    );

    expect(statements(fake)[0]).toContain(
      'CREATE TABLE IF NOT EXISTS entifix_outbox',
    );
    expect(hooks).toEqual([
      expect.objectContaining({ name: 'outbox-relay', phase: 'flush' }),
      expect.objectContaining({ name: 'outbox-relay', phase: 'flush' }),
    ]);
  });

  it('drains now what a write just recorded, and reports a drain that failed', async () => {
    const { fake, sql } = fresh();
    const { bus, published } = recordingBus();
    fake.respondTo('UPDATE entifix_outbox AS t', [aRow('e-1')]);
    const outcomes: RelayOutcome[] = [];
    const provide = Effect.provide(
      Layer.mergeAll(
        Layer.succeed(SqlClient.SqlClient, sql),
        Layer.succeed(EventBusTag, bus),
        Layer.succeed(OutboxMaxAttempts, 3),
      ),
    );

    await run(drainSqlOutboxNow('workflow').pipe(provide));
    fake.failWith('down');
    await run(
      drainSqlOutboxNow('workflow', outcome =>
        Effect.sync(() => {
          outcomes.push(outcome);
        }),
      ).pipe(provide),
    );

    expect(published).toEqual(['e-1']);
    expect(outcomes).toEqual([
      expect.objectContaining({ _tag: 'drainFailed', database: 'workflow' }),
    ]);
  });
});
