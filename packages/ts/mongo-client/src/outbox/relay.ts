import {
  ShutdownRegistryTag,
  type TenantDirectory,
  TenantDirectoryTag,
} from '@entifix/business';
import {
  aggregateKey,
  type EventBus,
  EventBusTag,
  type Outbox,
  type OutboxStats,
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
 * What a relay pass did, for the host to log
 * ([ADR 0013](../../../../../docs/adr/0013-failures-are-typed-values-decided-at-the-shell.md)).
 *
 * The relay decides nothing about level or sink: it says what happened and the
 * fork site that started it — the slice's shell — decides how loud that is. A
 * `failure` is whatever the store or the bus failed with; a typed one carries
 * its code and category for the log line.
 */
export type RelayOutcome =
  | {
      readonly _tag: 'drained';
      readonly database: string;
      readonly sent: number;
    }
  | {
      readonly _tag: 'quarantined';
      readonly database: string;
      readonly eventId: string;
      readonly eventName: string;
      readonly attempts: number;
      readonly code: string;
      readonly reason: string;
    }
  | {
      readonly _tag: 'sweepFailed';
      readonly database?: string;
      readonly failure: unknown;
    }
  | {
      readonly _tag: 'drainFailed';
      readonly database: string;
      readonly failure: unknown;
    };

/** Where a relay's outcomes go. The host's fork site supplies it. */
export type RelayOutcomeSink = (outcome: RelayOutcome) => Effect.Effect<void>;

/**
 * Hears nothing. The default only so a spec can start a relay without one —
 * a host that passes no sink has a relay nobody can watch.
 */
export const ignoreRelayOutcome: RelayOutcomeSink = () => Effect.void;

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
  /** Where the pass reports what it did; see {@link RelayOutcome}. */
  readonly onOutcome?: RelayOutcomeSink;
}

/**
 * Publish one batch of pending entries, oldest first, **in order within each
 * aggregate** ([ADR 0018](../../../../../docs/adr/0018-one-outbox-ordered-per-aggregate.md)),
 * and answer how many went.
 *
 * - A **still-deliverable** failure holds back the rest of its own aggregate
 *   for this pass, which is what stops a terminal event overtaking the
 *   `accepted` of the same transaction — and only its own: every other
 *   aggregate keeps draining.
 * - A **quarantined** failure moves on. An entry that can never publish must
 *   not hold its aggregate forever, and a consumer discards whatever older
 *   version arrives after a newer one anyway.
 */
export const drainOutbox = (
  outbox: Outbox,
  bus: EventBus,
  options: DrainOptions,
) =>
  Effect.gen(function* () {
    const entries = yield* outbox.pending(BATCH);
    const held = new Set<string>();
    let sent = 0;
    const report = options.onOutcome ?? ignoreRelayOutcome;
    for (const entry of entries) {
      const key = aggregateKey(entry.aggregate);
      if (held.has(key)) continue;

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
          held.add(key);
          continue;
        }

        yield* report({
          _tag: 'quarantined',
          database: options.database,
          eventId: entry.eventId,
          eventName: entry.event.name,
          attempts,
          code: outcome.failure.code,
          reason: failureText(outcome.failure),
        });
        continue;
      }

      yield* outbox.markSent(entry);
      sent += 1;
    }
    yield* report({ _tag: 'drained', database: options.database, sent });
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
 * Every failure is caught and reported as `sweepFailed`. This runs inside
 * `Effect.forever`, and an error that escapes ends the daemon silently — a
 * relay that stopped is indistinguishable from a relay with nothing to do.
 */
export const sweepOutbox = (
  outbox: Outbox,
  bus: EventBus,
  options: DrainOptions & { readonly onStats?: OutboxStatsSink },
) =>
  Effect.gen(function* () {
    yield* drainOutbox(outbox, bus, options);
    const sink = options.onStats ?? recordOutboxStats;
    yield* sink(options.database, yield* outbox.stats());
  }).pipe(
    Effect.catch(failure =>
      (options.onOutcome ?? ignoreRelayOutcome)({
        _tag: 'sweepFailed',
        database: options.database,
        failure,
      }),
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
