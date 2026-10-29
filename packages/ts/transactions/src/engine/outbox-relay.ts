import { ShutdownRegistryTag } from '@entifix/business';
import { Context, Duration, Effect, Fiber, Result } from 'effect';

import {
  aggregateKey,
  type Outbox,
  type OutboxStats,
} from '../contracts/outbox.js';
import type { EventBus } from '../ports/event-bus.js';
import { recordOutboxStats } from './outbox-metrics.js';

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
 * Runs `sweepOnce` every {@link SWEEP_INTERVAL}, and once more on the way out.
 *
 * Interrupting the daemon before that last pass is what stops two sweeps
 * publishing the same entry; running the pass is what the hook is for — an
 * event committed a moment before shutdown would otherwise wait out the next
 * process's whole interval.
 */
export const runRelayDaemon = (sweepOnce: Effect.Effect<void>) =>
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
