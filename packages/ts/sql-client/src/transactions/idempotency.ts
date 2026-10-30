import type {
  IdempotencyClaim,
  IdempotencyRecord,
  IdempotencyStore,
  StoredResponse,
} from '@entifix/business';
import { Effect } from 'effect';
import type { SqlClient } from 'effect/sql';

import { translateSqlError } from '../errors/translate-sql-error.js';

interface IdempotencyRow {
  readonly dedup_key: string;
  readonly fingerprint: string;
  readonly state: 'inFlight' | 'completed';
  readonly response: StoredResponse | string | null;
  readonly expires_at: Date | string;
}

const recordOf = (row: IdempotencyRow): IdempotencyRecord => ({
  dedupKey: row.dedup_key,
  fingerprint: row.fingerprint,
  state: row.state,
  ...(row.response == null
    ? {}
    : {
        response:
          typeof row.response === 'string'
            ? (JSON.parse(row.response) as StoredResponse)
            : row.response,
      }),
  expiresAt: new Date(row.expires_at).toISOString(),
});

export interface SqlIdempotencyOptions {
  /** How long a record lives, in milliseconds. */
  readonly retentionMs: number;
  /** The clock, in epoch milliseconds. */
  readonly now?: () => number;
}

const fault = (error: unknown) => translateSqlError(error);

/**
 * The idempotency store over SQL. A claim is one statement: it inserts the key,
 * or takes over a record that has expired, and only one of two concurrent
 * callers sees its row come back.
 */
export const makeSqlIdempotencyStore = (
  sql: SqlClient.SqlClient,
  { retentionMs, now = Date.now }: SqlIdempotencyOptions,
): IdempotencyStore => ({
  claim: (dedupKey, fingerprint) =>
    Effect.gen(function* () {
      const at = new Date(now());
      const expiresAt = new Date(now() + retentionMs);
      const taken = yield* sql<{ readonly dedup_key: string }>`
        INSERT INTO entifix_idempotency (dedup_key, fingerprint, state, expires_at)
        VALUES (${dedupKey}, ${fingerprint}, 'inFlight', ${expiresAt})
        ON CONFLICT (dedup_key) DO UPDATE
          SET fingerprint = EXCLUDED.fingerprint, state = 'inFlight',
              response = NULL, expires_at = EXCLUDED.expires_at
          WHERE entifix_idempotency.expires_at <= ${at}
        RETURNING dedup_key`;
      if (taken.length > 0) return { _tag: 'claimed' } as IdempotencyClaim;
      const [existing] = yield* sql<IdempotencyRow>`
        SELECT * FROM entifix_idempotency WHERE dedup_key = ${dedupKey}`;
      // Released between the two statements: one more claim takes it.
      if (existing === undefined) {
        yield* sql`
          INSERT INTO entifix_idempotency (dedup_key, fingerprint, state, expires_at)
          VALUES (${dedupKey}, ${fingerprint}, 'inFlight', ${expiresAt})`;
        return { _tag: 'claimed' } as IdempotencyClaim;
      }
      return {
        _tag: 'existing',
        record: recordOf(existing),
      } as IdempotencyClaim;
    }).pipe(Effect.mapError(fault)),

  complete: (dedupKey, response) =>
    sql`
      UPDATE entifix_idempotency
      SET state = 'completed', response = ${JSON.stringify(response)}::jsonb
      WHERE dedup_key = ${dedupKey}`.pipe(
      Effect.asVoid,
      Effect.mapError(fault),
    ),

  release: dedupKey =>
    sql`DELETE FROM entifix_idempotency WHERE dedup_key = ${dedupKey}`.pipe(
      Effect.asVoid,
      Effect.mapError(fault),
    ),
});
