import type { Outbox, OutboxEntry, OutboxEvent } from '@entifix/transactions';
import { Effect } from 'effect';
import type { SqlClient } from 'effect/sql';

import { translateSqlError } from '../errors/translate-sql-error.js';

/** A row of `entifix_outbox`, as the driver hands it back. */
// A type alias, not an interface: a row must be assignable to the record a
// driver hands back, and an interface has no index signature.
export type OutboxRow = {
  readonly event_id: string;
  readonly aggregate_type: string;
  readonly aggregate_id: string;
  readonly version: number;
  readonly event: OutboxEvent | string;
  readonly attempts: number;
  readonly last_error: string | null;
  readonly quarantined: boolean;
  readonly sent: boolean;
  readonly created_at: Date | string;
};

const iso = (value: Date | string): string =>
  value instanceof Date ? value.toISOString() : new Date(value).toISOString();

/** A row as the outbox port's entry. `jsonb` may arrive parsed or as text. */
export const entryOf = (row: OutboxRow): OutboxEntry => ({
  eventId: row.event_id,
  aggregate: { type: row.aggregate_type, id: row.aggregate_id },
  version: row.version,
  event:
    typeof row.event === 'string'
      ? (JSON.parse(row.event) as OutboxEvent)
      : row.event,
  sent: row.sent,
  attempts: row.attempts,
  ...(row.last_error === null ? {} : { lastError: row.last_error }),
  quarantined: row.quarantined,
  createdAt: iso(row.created_at),
});

/** The values one event is inserted with. */
export const outboxRow = (event: OutboxEvent) => ({
  event_id: event.id,
  aggregate_type: event.aggregate.type,
  aggregate_id: event.aggregate.id,
  version: event.version,
  event: JSON.stringify(event),
  created_at: event.at,
});

export interface SqlOutboxOptions {
  /**
   * How long a relay holds the entries it took before another may take them —
   * long enough to publish a batch, short enough that a relay that died does
   * not hold its aggregates past the next sweep. Thirty seconds by default.
   */
  readonly leaseSeconds?: number;
}

const fault = (error: unknown) => translateSqlError(error);

/**
 * The outbox over Postgres
 * ([ADR 0018](../../../../../docs/adr/0018-one-outbox-ordered-per-aggregate.md)).
 *
 * `pending` **claims** what it returns: it leases the oldest entries of the
 * aggregates no other relay holds, with `FOR UPDATE SKIP LOCKED` and an
 * advisory lock per aggregate taken in the same statement, so several runners
 * drain one table without publishing an entry twice or two versions of one
 * aggregate out of order. A failure gives the whole aggregate back at once, so
 * the next pass retries it rather than waiting out the lease.
 */
export const makeSqlOutbox = (
  sql: SqlClient.SqlClient,
  options: SqlOutboxOptions = {},
): Outbox => {
  const lease = `${String(options.leaseSeconds ?? 30)} seconds`;
  return {
    enqueue: event =>
      sql<{ readonly event_id: string }>`
        INSERT INTO entifix_outbox ${sql.insert(outboxRow(event))}
        ON CONFLICT (event_id) DO NOTHING
        RETURNING event_id`.pipe(
        Effect.map(rows =>
          rows.length === 0 ? ('duplicate' as const) : ('enqueued' as const),
        ),
        Effect.mapError(fault),
      ),

    pending: limit =>
      sql<OutboxRow>`
        WITH picked AS (
          SELECT o.event_id FROM entifix_outbox o
          WHERE NOT o.sent AND NOT o.quarantined
            AND (o.lease_until IS NULL OR o.lease_until < now())
            AND NOT EXISTS (
              SELECT 1 FROM entifix_outbox h
              WHERE h.aggregate_type = o.aggregate_type
                AND h.aggregate_id = o.aggregate_id
                AND NOT h.sent AND NOT h.quarantined
                AND h.lease_until >= now()
            )
            AND pg_try_advisory_xact_lock(
              hashtext(o.aggregate_type || ':' || o.aggregate_id)
            )
          ORDER BY o.created_at, o.version
          LIMIT ${limit}
          FOR UPDATE SKIP LOCKED
        )
        UPDATE entifix_outbox AS t
        SET lease_until = now() + ${lease}::interval
        FROM picked WHERE t.event_id = picked.event_id
        RETURNING t.*`.pipe(
        Effect.map(rows =>
          rows
            .map(entryOf)
            .sort(
              (a, b) =>
                a.createdAt.localeCompare(b.createdAt) || a.version - b.version,
            ),
        ),
        Effect.mapError(fault),
      ),

    markSent: entry =>
      sql`
        UPDATE entifix_outbox SET sent = true, lease_until = NULL
        WHERE event_id = ${entry.eventId}`.pipe(
        Effect.asVoid,
        Effect.mapError(fault),
      ),

    recordFailure: (entry, error, quarantine) =>
      sql`
        UPDATE entifix_outbox
        SET attempts = attempts + 1, last_error = ${error},
            quarantined = ${quarantine}
        WHERE event_id = ${entry.eventId}`.pipe(
        Effect.andThen(
          sql`
            UPDATE entifix_outbox SET lease_until = NULL
            WHERE aggregate_type = ${entry.aggregate.type}
              AND aggregate_id = ${entry.aggregate.id} AND NOT sent`,
        ),
        Effect.asVoid,
        Effect.mapError(fault),
      ),

    stats: () =>
      sql<{
        readonly pending: string | number;
        readonly quarantined: string | number;
        readonly oldest: Date | string | null;
      }>`
        SELECT
          count(*) FILTER (WHERE NOT sent AND NOT quarantined) AS pending,
          count(*) FILTER (WHERE quarantined) AS quarantined,
          min(created_at) FILTER (WHERE NOT sent AND NOT quarantined) AS oldest
        FROM entifix_outbox`.pipe(
        Effect.map(([row]) => ({
          pending: Number(row?.pending ?? 0),
          quarantined: Number(row?.quarantined ?? 0),
          ...(row?.oldest == null ? {} : { oldestPendingAt: iso(row.oldest) }),
        })),
        Effect.mapError(fault),
      ),
  };
};
