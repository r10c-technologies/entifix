import { PgClient } from '@effect/sql-pg';
import type { StoreFault } from '@entifix/core';
import type { DomainEvent } from '@entifix/core';
import {
  describeIdempotencyStoreContract,
  describeOutboxContract,
  describeUnitOfWorkContract,
} from '@entifix/testing-unit/contracts';
import type { EventBus, OutboxEvent } from '@entifix/transactions';
import { drainOutbox } from '@entifix/transactions/engine';
import { Effect, Layer, ManagedRuntime, Redacted } from 'effect';
import { SqlClient } from 'effect/sql';
import { afterAll, describe, expect, it } from 'vitest';

import { translateSqlError } from '../errors/translate-sql-error.js';
import { makeSqlIdempotencyStore } from './idempotency.js';
import { makeSqlOutbox } from './outbox.js';
import { ensureSqlTransactionTables } from './schema.js';
import { makeSqlUnitOfWork, type SqlUnit } from './unit-of-work.js';

/*
 * Against a real Postgres: the URL is required, so a run without one fails
 * here rather than reporting green over nothing.
 */
const url = process.env['ENTIFIX_PG_URL'];
if (url === undefined || url === '')
  throw new Error(
    'ENTIFIX_PG_URL is not set: the SQL contract suites run against a real Postgres',
  );

const runtime = ManagedRuntime.make(
  PgClient.layer({
    url: Redacted.make(url),
  }) as Layer.Layer<SqlClient.SqlClient>,
);
afterAll(() => runtime.dispose());

const run = <A, E>(effect: Effect.Effect<A, E, SqlClient.SqlClient>) =>
  runtime.runPromise(effect);

/** A clean schema per case: every contract case starts from nothing. */
const reset = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* ensureSqlTransactionTables(sql);
  yield* sql`
    CREATE TABLE IF NOT EXISTS contract_widget (id text PRIMARY KEY)`;
  yield* sql`
    TRUNCATE entifix_outbox, entifix_inbox, entifix_command_inbox,
      entifix_idempotency, contract_widget`;
  return sql;
});

describeOutboxContract('Postgres', () =>
  Effect.promise(() => run(reset)).pipe(
    Effect.map(sql => {
      const outbox = makeSqlOutbox(sql);
      return {
        outbox,
        drain: (bus: EventBus, maxAttempts: number) =>
          Effect.promise(() =>
            run(
              drainOutbox(outbox, bus, { maxAttempts, database: 'contract' }),
            ),
          ),
      };
    }),
  ),
);

describeUnitOfWorkContract<SqlUnit>('Postgres', async () => {
  const sql = await run(reset);
  const unitOfWork = makeSqlUnitOfWork(sql);
  const fault = (error: unknown) => translateSqlError(error) as StoreFault;
  // The client's statements carry their connection with them, so a body's
  // writes run inside the unit's transaction on the fiber that runs the unit.
  return {
    unitOfWork,
    write: (handle, id) =>
      handle.sql`INSERT INTO contract_widget (id) VALUES (${id})`.pipe(
        Effect.asVoid,
        Effect.mapError(fault),
      ),
    readIn: (handle, id) =>
      handle.sql<{ readonly id: string }>`
        SELECT id FROM contract_widget WHERE id = ${id}`.pipe(
        Effect.map(rows => rows.length > 0),
        Effect.mapError(fault),
      ),
    stored: async id =>
      (
        await run(
          sql<{ readonly id: string }>`
            SELECT id FROM contract_widget WHERE id = ${id}`,
        )
      ).length > 0,
    recorded: async () =>
      (
        await run(
          sql<{
            readonly event_id: string;
          }>`SELECT event_id FROM entifix_outbox`,
        )
      ).map(row => row.event_id),
  };
});

describeIdempotencyStoreContract('Postgres', (clock, retentionMs) =>
  Effect.promise(() => run(reset)).pipe(
    Effect.map(sql =>
      makeSqlIdempotencyStore(sql, { retentionMs, now: () => clock.now() }),
    ),
  ),
);

describe('two relays over one outbox', () => {
  it('never publish one entry twice, and keep each aggregate in order', async () => {
    const sql = await run(reset);
    const outbox = makeSqlOutbox(sql);
    const events: OutboxEvent[] = [];
    for (let aggregate = 0; aggregate < 10; aggregate += 1)
      for (let version = 1; version <= 5; version += 1)
        events.push({
          name: 'contract.changed',
          id: `a${String(aggregate)}:${String(version)}`,
          source: 'contract',
          at: new Date(Date.UTC(2026, 0, 1, 0, 0, version)).toISOString(),
          aggregate: { type: 'contract', id: `a${String(aggregate)}` },
          version,
          data: {},
        });
    for (const event of events) await run(outbox.enqueue(event));

    const published: DomainEvent[] = [];
    const bus: EventBus = {
      publish: event =>
        Effect.sync(() => {
          published.push(event);
        }).pipe(Effect.delay('1 millis')),
      subscribe: () => Effect.void,
    };
    const relay = () =>
      run(drainOutbox(outbox, bus, { maxAttempts: 3, database: 'contract' }));
    for (let pass = 0; pass < 20 && published.length < events.length; pass += 1)
      await Promise.all([relay(), relay(), relay()]);

    const ids = published.map(event => event.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toHaveLength(events.length);
    for (let aggregate = 0; aggregate < 10; aggregate += 1) {
      const versions = published
        .filter(event => event.id.startsWith(`a${String(aggregate)}:`))
        .map(event => (event as OutboxEvent).version);
      expect(versions).toEqual([1, 2, 3, 4, 5]);
    }
  });
});
