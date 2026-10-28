import {
  ShutdownRegistryTag,
  type TenantDirectory,
  TenantDirectoryTag,
} from '@entifix/business';
import {
  type EventBus,
  EventBusTag,
  type OutboxStats,
  type TransactionOutbox,
} from '@entifix/transactions';
import { Context, Duration, Effect, Fiber, Result } from 'effect';
import type { Db } from 'mongodb';

import { MongoDatabaseTag } from '../mongo-database/mongo-database.js';
import { recordOutboxStats } from './metrics.js';
import { ensureOutboxIndexes, makeMongoOutbox } from './store.js';

/** How often the sweep looks for entries the fast path did not carry. */
/**
 * What an outbox entry records as the reason its publish failed: the failure's
 * own message, or its code when it carries none — never empty, because an
 * operator reading a quarantined entry has nothing else to go on.
 */
const failureText = (failure: {
  readonly message: string;
  readonly code: string;
}) => (failure.message === '' ? failure.code : failure.message);

export const SWEEP_INTERVAL = Duration.seconds(15);
/** Entries drained per pass, per database. */
export const BATCH = 100;

/**
 * Publish attempts an outbox entry gets before it is quarantined, from
 * config-service.
 *
 * Configuration rather than a constant because it is a genuine operational
 * tunable: raising it while a flaky broker settles is a config edit, and the
 * next sweep reads the new value. That is the opposite of a subscription's
 * `maxAttempts`, which becomes an immutable queue argument and therefore stays
 * a literal beside its declaration.
 *
 * ⚠️ **Read it with `getNumber`, never a cast.** A value of `'five'` casts to
 * `NaN`, every `attempts >= maxAttempts` comparison goes false, and nothing is
 * ever quarantined — a relay that looks healthy while its head never moves.
 */
export class OutboxMaxAttempts extends Context.Service<
  OutboxMaxAttempts,
  number
>()('OutboxMaxAttempts') {}

/** What {@link drainOutbox} needs beyond the ports it publishes through. */
export interface DrainOptions {
  readonly maxAttempts: number;
  /** The database being drained; carried so a quarantine log names it. */
  readonly database: string;
}

/**
 * Publish one batch of pending entries, oldest first, and answer how many went.
 *
 * Two orderings are load-bearing here and neither is obvious:
 *
 * - A **still-deliverable** failure returns immediately rather than continuing.
 *   The entries behind this one keep their order relative to it, which is what
 *   stops a terminal event overtaking the `accepted` for the same transaction.
 * - A **quarantined** failure continues. That is the deliberate
 *   skip-so-the-head-moves: an entry that can never publish must stop blocking
 *   every entry behind it forever.
 */
export const drainOutbox = (
  outbox: TransactionOutbox,
  bus: EventBus,
  options: DrainOptions,
) =>
  Effect.gen(function* () {
    const entries = yield* outbox.pending(BATCH);
    let sent = 0;
    for (const entry of entries) {
      const outcome = yield* Effect.result(bus.publish(entry.event));

      if (Result.isFailure(outcome)) {
        const attempts = entry.attempts + 1;
        const quarantine = attempts >= options.maxAttempts;

        yield* outbox.recordFailure(
          entry,
          failureText(outcome.failure),
          quarantine,
        );

        if (!quarantine) {
          return sent;
        }

        yield* Effect.logError('outbox entry quarantined').pipe(
          Effect.annotateLogs({
            database: options.database,
            eventId: entry.eventId,
            eventName: entry.event.name,
            attempts,
            lastError: failureText(outcome.failure),
          }),
        );
        continue;
      }

      yield* outbox.markSent(entry);
      sent += 1;
    }
    return sent;
  });

/**
 * Sample a sweep's depth and age.
 *
 * Defaults to {@link recordOutboxStats}, and a caller overrides it only to
 * assert what was sampled. There is no "no sink" option on purpose: an outbox
 * whose depth nothing reports is the failure the gauges exist to make visible.
 */
export type OutboxStatsSink = (
  database: string,
  stats: OutboxStats,
) => Effect.Effect<void>;

/**
 * Drain the one database this service owns, then sample its depth.
 *
 * The single-database counterpart to `startTenantOutboxRelay`. A
 * platform-plane store is one named database, so there is nothing to enumerate
 * and `listDatabases` — which needs a `MongoClient` and cluster-wide rights —
 * never comes into it.
 *
 * Stats are sampled **after** the drain, so the gauge reports what is still
 * waiting rather than what was waiting when the pass began.
 *
 * Every failure is caught and logged. This runs inside `Effect.forever`, and an
 * error that escapes ends the daemon silently — a relay that stopped is
 * indistinguishable from a relay with nothing to do.
 */
export const sweepOutbox = (
  outbox: TransactionOutbox,
  bus: EventBus,
  options: DrainOptions & { readonly onStats?: OutboxStatsSink },
) =>
  Effect.gen(function* () {
    yield* drainOutbox(outbox, bus, options);
    const sink = options.onStats ?? recordOutboxStats;
    yield* sink(options.database, yield* outbox.stats());
  }).pipe(
    Effect.catch(error =>
      Effect.logError('outbox sweep failed').pipe(
        Effect.annotateLogs({
          database: options.database,
          error: String(error),
        }),
      ),
    ),
  );

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
      }),
    );
  });

/**
 * Runs `sweepOnce` every {@link SWEEP_INTERVAL}, and once more on the way out.
 *
 * Interrupting the daemon before that last pass is what stops two sweeps
 * publishing the same entry; running the pass is what the hook is for — an
 * event committed a moment before shutdown would otherwise wait out the next
 * process's whole interval.
 */
const runRelayDaemon = (sweepOnce: Effect.Effect<void>) =>
  Effect.gen(function* () {
    const shutdown = yield* ShutdownRegistryTag;

    const daemon = yield* Effect.forkDetach(
      sweepOnce.pipe(Effect.delay(SWEEP_INTERVAL), Effect.forever),
    );

    yield* shutdown.register({
      name: 'outbox-relay',
      phase: 'flush',
      run: Fiber.interrupt(daemon).pipe(Effect.andThen(sweepOnce)),
    });
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
    readonly ensured?: Set<string>;
  },
) =>
  Effect.gen(function* () {
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
          ...(options.onStats ? { onStats: options.onStats } : {}),
        });
      }).pipe(
        Effect.catch(error =>
          Effect.logError('draining a tenant outbox failed').pipe(
            Effect.annotateLogs({ database, error: String(error) }),
          ),
        ),
      );
    }
  }).pipe(
    Effect.catch(error =>
      Effect.logError('tenant outbox sweep failed').pipe(
        Effect.annotateLogs({ error: String(error) }),
      ),
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
      }),
    );
  });

/**
 * Drain one database's outbox now, for a write path that has just committed.
 *
 * The fast path the sweep is the fallback for: an event drained here leaves as
 * soon as its transaction commits, rather than up to {@link SWEEP_INTERVAL}
 * later. Every failure is logged and swallowed — the entry is still in the
 * outbox, and the sweep will carry it.
 */
export const drainOutboxNow = (db: Db) =>
  Effect.gen(function* () {
    const bus = yield* EventBusTag;
    const maxAttempts = yield* OutboxMaxAttempts;
    yield* drainOutbox(makeMongoOutbox(db), bus, {
      maxAttempts,
      database: db.databaseName,
    });
  }).pipe(
    Effect.catch(error =>
      Effect.logWarning('inline outbox drain failed').pipe(
        Effect.annotateLogs({
          database: db.databaseName,
          error: String(error),
        }),
      ),
    ),
  );
