import { EventBusTag, OutboxMaxAttempts } from '@entifix/transactions';
import {
  drainOutbox,
  ignoreRelayOutcome,
  type OutboxStatsSink,
  type RelayOutcomeSink,
  runRelayDaemon,
  sweepOutbox,
} from '@entifix/transactions/engine';
import { Effect } from 'effect';
import { SqlClient } from 'effect/sql';

import { makeSqlOutbox } from './outbox.js';
import { ensureSqlTransactionTables } from './schema.js';

/**
 * Starts the relay over the service's SQL database: the tables are ensured, a
 * daemon sweeps the outbox, and its last sweep runs in the `flush` phase of a
 * shutdown, after consumers have stopped and while the bus is still open.
 * Several replicas may run it at once — the outbox's claim keeps them apart.
 */
export const startSqlOutboxRelay = (options: {
  /** What the outbox's outcomes and gauges are labelled with. */
  readonly database: string;
  readonly onStats?: OutboxStatsSink;
  readonly onOutcome?: RelayOutcomeSink;
}) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    const bus = yield* EventBusTag;
    const maxAttempts = yield* OutboxMaxAttempts;
    yield* ensureSqlTransactionTables(sql);
    yield* runRelayDaemon(
      sweepOutbox(makeSqlOutbox(sql), bus, {
        maxAttempts,
        database: options.database,
        ...(options.onStats ? { onStats: options.onStats } : {}),
        ...(options.onOutcome ? { onOutcome: options.onOutcome } : {}),
      }),
    );
  });

/**
 * One drain now, for a write that just committed — the event leaves at once
 * rather than at the next sweep. A failure is reported and left to the sweep.
 */
export const drainSqlOutboxNow = (
  database: string,
  onOutcome: RelayOutcomeSink = ignoreRelayOutcome,
) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    const bus = yield* EventBusTag;
    const maxAttempts = yield* OutboxMaxAttempts;
    yield* drainOutbox(makeSqlOutbox(sql), bus, {
      maxAttempts,
      database,
      onOutcome,
    });
  }).pipe(
    Effect.catch(failure =>
      onOutcome({ _tag: 'drainFailed', database, failure }),
    ),
  );
