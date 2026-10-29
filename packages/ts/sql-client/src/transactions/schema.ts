import { Effect } from 'effect';
import type { SqlClient } from 'effect/sql';

import { translateSqlError } from '../errors/translate-sql-error.js';

/** The tables the outbox, the inboxes and the idempotency store live in. */
export const SQL_TRANSACTION_TABLES = {
  outbox: 'entifix_outbox',
  inbox: 'entifix_inbox',
  commandInbox: 'entifix_command_inbox',
  idempotency: 'entifix_idempotency',
} as const;

/**
 * Creates the outbox, the event and command inboxes and the idempotency table
 * if they are missing. Idempotent, so a service runs it on every boot; Postgres
 * dialect, because the outbox's claim rides `FOR UPDATE SKIP LOCKED` and an
 * advisory lock.
 */
export const ensureSqlTransactionTables = (sql: SqlClient.SqlClient) =>
  Effect.gen(function* () {
    yield* sql`
      CREATE TABLE IF NOT EXISTS entifix_outbox (
        event_id text PRIMARY KEY,
        aggregate_type text NOT NULL,
        aggregate_id text NOT NULL,
        version integer NOT NULL,
        event jsonb NOT NULL,
        sent boolean NOT NULL DEFAULT false,
        attempts integer NOT NULL DEFAULT 0,
        last_error text,
        quarantined boolean NOT NULL DEFAULT false,
        created_at timestamptz NOT NULL,
        lease_until timestamptz
      )`;
    yield* sql`
      CREATE INDEX IF NOT EXISTS entifix_outbox_pending
        ON entifix_outbox (created_at, version)
        WHERE NOT sent AND NOT quarantined`;
    yield* sql`
      CREATE TABLE IF NOT EXISTS entifix_inbox (
        consumer text NOT NULL,
        event_id text NOT NULL,
        claimed_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (consumer, event_id)
      )`;
    yield* sql`
      CREATE TABLE IF NOT EXISTS entifix_command_inbox (
        command_id text PRIMARY KEY,
        claimed_at timestamptz NOT NULL DEFAULT now(),
        replay jsonb
      )`;
    yield* sql`
      CREATE TABLE IF NOT EXISTS entifix_idempotency (
        dedup_key text PRIMARY KEY,
        fingerprint text NOT NULL,
        state text NOT NULL,
        response jsonb,
        expires_at timestamptz NOT NULL
      )`;
  }).pipe(Effect.mapError(error => translateSqlError(error)));
