import { translateSqlError } from '@entifix/sql';
import { Data, Duration, Effect, Layer, Option } from 'effect';
import { SqlClient } from 'effect/sql';

import { TERMINAL_FLOW_STATES } from '../status/flow-status-store.js';

/** How often the purge looks for journals past their retention, by default. */
export const JOURNAL_PURGE_INTERVAL = Duration.hours(1);
/** Flows purged per statement, by default. */
export const JOURNAL_PURGE_BATCH = 100;

/** What one purge pass did, for the host to log; the package logs nothing. */
export type JournalPurgeOutcome =
  | { readonly _tag: 'purged'; readonly flows: number }
  | { readonly _tag: 'purgeFailed'; readonly failure: unknown };

/**
 * How long a finished flow's journal is kept. The journal holds every flow's
 * start input and step inputs, which can carry personal data, so retention is
 * the store owner's — the engine's — and the host must state it: there is no
 * default that silently keeps everything forever.
 */
export interface JournalRetention {
  /** How long after a flow ends its journal is purged. Required, and positive. */
  readonly journalRetention: Duration.Input;
  /** How often the purge runs. Defaults to {@link JOURNAL_PURGE_INTERVAL}. */
  readonly purgeInterval?: Duration.Input;
  /** Flows purged per statement. Defaults to {@link JOURNAL_PURGE_BATCH}. */
  readonly purgeBatch?: number;
  /** Told what each pass did. */
  readonly onPurge?: (outcome: JournalPurgeOutcome) => Effect.Effect<void>;
}

/** The engine was started without a usable retention for its journal. */
export class JournalRetentionUnset extends Data.TaggedError(
  'JournalRetentionUnset',
)<{ readonly dial: 'journalRetention'; readonly reason: string }> {
  override get message(): string {
    return this.reason;
  }
}

const positive = (input: Duration.Input | undefined): Duration.Duration =>
  Option.match(
    input === undefined ? Option.none() : Duration.fromInput(input),
    {
      onNone: () => Duration.zero,
      onSome: duration => duration,
    },
  );

/** The dials, checked; a retention that is missing, unreadable or not positive fails. */
const readRetention = (options: JournalRetention) =>
  Effect.gen(function* () {
    const retention = positive(options.journalRetention);
    if (!Duration.isGreaterThan(retention, Duration.zero)) {
      return yield* Effect.fail(
        new JournalRetentionUnset({
          dial: 'journalRetention',
          reason:
            options.journalRetention === undefined
              ? 'the flow engine needs journalRetention: how long a finished flow keeps its journal'
              : `journalRetention ${String(options.journalRetention)} is not a positive duration`,
        }),
      );
    }
    const interval = positive(options.purgeInterval);
    return {
      retention,
      interval: Duration.isGreaterThan(interval, Duration.zero)
        ? interval
        : JOURNAL_PURGE_INTERVAL,
      batch:
        options.purgeBatch !== undefined && options.purgeBatch > 0
          ? Math.floor(options.purgeBatch)
          : JOURNAL_PURGE_BATCH,
    };
  });

const TERMINAL = TERMINAL_FLOW_STATES.map(state => `'${state}'`).join(', ');

/**
 * Purges one batch: the flows that ended more than `retention` ago and still
 * hold a journal lose their messages and replies — every one the workflow and
 * its clock entity recorded under the flow's execution id — and their status
 * row keeps its state, step and timestamps but drops its payload columns and
 * is stamped purged. One statement, so a batch is all or nothing; rows locked
 * by a concurrent pass are skipped, never waited on. Answers how many flows it
 * purged.
 */
export const purgeFinishedJournals = (
  sql: SqlClient.SqlClient,
  retention: Duration.Duration,
  batch: number = JOURNAL_PURGE_BATCH,
) =>
  sql<{ readonly flow_id: string }>`
    WITH due AS (
      SELECT flow_id, execution_id FROM entifix_flow_status
      WHERE state IN (${sql.literal(TERMINAL)})
        AND purged_at IS NULL
        AND terminal_at < now() - make_interval(secs => ${Duration.toSeconds(retention)})
      ORDER BY terminal_at
      LIMIT ${batch}
      FOR UPDATE SKIP LOCKED
    ),
    replies AS (
      DELETE FROM cluster_replies WHERE request_id IN (
        SELECT id FROM cluster_messages
        WHERE entity_id IN (SELECT execution_id FROM due)
      )
    ),
    messages AS (
      DELETE FROM cluster_messages
      WHERE entity_id IN (SELECT execution_id FROM due)
    )
    UPDATE entifix_flow_status
    SET correlation = NULL, accepts = NULL, purged_at = now()
    WHERE flow_id IN (SELECT flow_id FROM due)
    RETURNING flow_id`.pipe(
    Effect.map(rows => rows.length),
    Effect.mapError(error => translateSqlError(error)),
  );

/** Purges batch after batch until one comes back short. */
const purgeAll = (
  sql: SqlClient.SqlClient,
  retention: Duration.Duration,
  batch: number,
) =>
  Effect.gen(function* () {
    let total = 0;
    for (;;) {
      const purged = yield* purgeFinishedJournals(sql, retention, batch);
      total += purged;
      if (purged < batch) return total;
    }
  });

/**
 * The purge as a daemon beside the runner, for as long as the engine's layer
 * lives: one pass every interval, the first an interval after start — by then
 * the engine has created the tables it purges. A failed pass is reported and
 * the next one runs — a purge that stopped would look exactly like one with
 * nothing to do. Fails to build with {@link JournalRetentionUnset} when the
 * retention is not stated.
 */
export const JournalPurgeLayer = (options: JournalRetention) =>
  Layer.effectDiscard(
    Effect.gen(function* () {
      const { retention, interval, batch } = yield* readRetention(options);
      const sql = yield* SqlClient.SqlClient;
      const report = options.onPurge ?? (() => Effect.void);
      const pass = purgeAll(sql, retention, batch).pipe(
        Effect.matchEffect({
          onSuccess: flows => report({ _tag: 'purged', flows }),
          onFailure: failure => report({ _tag: 'purgeFailed', failure }),
        }),
      );
      yield* Effect.forkScoped(
        Effect.sleep(interval).pipe(Effect.andThen(pass), Effect.forever),
      );
    }),
  );
