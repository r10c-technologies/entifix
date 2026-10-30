import { type TenantDirectory, TenantDirectoryTag } from '@entifix/business';
import {
  type EventBus,
  EventBusTag,
  OutboxMaxAttempts,
} from '@entifix/transactions';
import {
  drainOutbox,
  ignoreRelayOutcome,
  type OutboxStatsSink,
  type RelayOutcomeSink,
  runRelayDaemon,
  sweepOutbox,
} from '@entifix/transactions/engine';
import { Effect } from 'effect';
import type { Db } from 'mongodb';

import { MongoDatabaseTag } from '../mongo-database/mongo-database.js';
import { ensureOutboxIndexes, makeMongoOutbox } from './store.js';

/**
 * Start the relay for a service that owns exactly one database.
 *
 * ⚠️ **The shutdown hook is `flush`, not `stop-intake`, and the phase is the
 * whole point.** `AmqpEventBusLayer` registers `stop-intake` to cancel consumers
 * and drain deliveries; this runs after that, so the last sweep publishes into a
 * connection that is still open. Registered the other way round it would try to
 * publish through a channel already closing, and the entries it was holding
 * would sit until the next boot.
 *
 * The daemon is `delay |> forever`, so the first sweep is one interval away
 * rather than at boot — the write path drains inline, and a sweep racing the
 * index bootstrap on a cold database only produces noise.
 */
export const startOutboxRelay = (options?: {
  readonly onStats?: OutboxStatsSink;
  readonly onOutcome?: RelayOutcomeSink;
}) =>
  Effect.gen(function* () {
    const db = yield* MongoDatabaseTag;
    const bus = yield* EventBusTag;
    const maxAttempts = yield* OutboxMaxAttempts;

    yield* ensureOutboxIndexes(db);
    const outbox = makeMongoOutbox(db);

    yield* runRelayDaemon(
      sweepOutbox(outbox, bus, {
        maxAttempts,
        database: db.databaseName,
        ...(options?.onStats ? { onStats: options.onStats } : {}),
        ...(options?.onOutcome ? { onOutcome: options.onOutcome } : {}),
      }),
    );
  });

/**
 * One pass over every organization's outbox in a per-organization store.
 *
 * ⚠️ **Each tenant is caught on its own.** A failure that recurs — an index
 * conflict on one old database, say — would otherwise abandon every tenant
 * listed after it on every pass, while the relay went on looking healthy.
 *
 * Indexes are ensured once per database per process (`ensured`), not on every
 * pass: a sweep visits every tenant every interval, and the index build is the
 * same request each time.
 */
export const sweepTenantOutboxes = (
  directory: TenantDirectory<Db>,
  bus: EventBus,
  options: {
    readonly maxAttempts: number;
    readonly onStats?: OutboxStatsSink;
    readonly onOutcome?: RelayOutcomeSink;
    readonly ensured?: Set<string>;
  },
) =>
  Effect.gen(function* () {
    const report = options.onOutcome ?? ignoreRelayOutcome;
    const ensured = options.ensured ?? new Set<string>();
    const tenants = yield* directory.list();

    for (const { handle: db } of tenants) {
      const database = db.databaseName;
      yield* Effect.gen(function* () {
        if (!ensured.has(database)) {
          yield* ensureOutboxIndexes(db);
          ensured.add(database);
        }
        yield* sweepOutbox(makeMongoOutbox(db), bus, {
          maxAttempts: options.maxAttempts,
          database,
          onOutcome: report,
          ...(options.onStats ? { onStats: options.onStats } : {}),
        });
      }).pipe(
        Effect.catch(failure =>
          report({ _tag: 'sweepFailed', database, failure }),
        ),
      );
    }
  }).pipe(
    Effect.catch(failure =>
      (options.onOutcome ?? ignoreRelayOutcome)({
        _tag: 'sweepFailed',
        failure,
      }),
    ),
  );

/**
 * Start the relay for a store with one database per organization, listed by
 * the {@link TenantDirectoryTag} the host provides.
 *
 * The same two speeds as {@link startOutboxRelay}: the write path drains its
 * own tenant inline with {@link drainOutboxNow}, and this sweep carries
 * whatever that missed.
 */
export const startTenantOutboxRelay = (options?: {
  readonly onStats?: OutboxStatsSink;
  readonly onOutcome?: RelayOutcomeSink;
}) =>
  Effect.gen(function* () {
    const directory = (yield* TenantDirectoryTag) as TenantDirectory<Db>;
    const bus = yield* EventBusTag;
    const maxAttempts = yield* OutboxMaxAttempts;
    const ensured = new Set<string>();

    yield* runRelayDaemon(
      sweepTenantOutboxes(directory, bus, {
        maxAttempts,
        ensured,
        ...(options?.onStats ? { onStats: options.onStats } : {}),
        ...(options?.onOutcome ? { onOutcome: options.onOutcome } : {}),
      }),
    );
  });

/**
 * Drain one database's outbox now, for a write path that has just committed.
 *
 * The fast path the sweep is the fallback for: an event drained here leaves as
 * soon as its transaction commits, rather than up to {@link SWEEP_INTERVAL}
 * later. Every failure is reported as `drainFailed` and swallowed — the entry
 * is still in the outbox, and the sweep will carry it.
 */
export const drainOutboxNow = (
  db: Db,
  onOutcome: RelayOutcomeSink = ignoreRelayOutcome,
) =>
  Effect.gen(function* () {
    const bus = yield* EventBusTag;
    const maxAttempts = yield* OutboxMaxAttempts;
    yield* drainOutbox(makeMongoOutbox(db), bus, {
      maxAttempts,
      database: db.databaseName,
      onOutcome,
    });
  }).pipe(
    Effect.catch(failure =>
      onOutcome({ _tag: 'drainFailed', database: db.databaseName, failure }),
    ),
  );
