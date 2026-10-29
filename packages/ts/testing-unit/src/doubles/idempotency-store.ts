import type { IdempotencyRecord, IdempotencyStore } from '@entifix/business';
import { Effect } from 'effect';

export interface IdempotencyStoreOptions {
  /** How long a record lives, in milliseconds. */
  readonly retentionMs: number;
  /** The clock, in epoch milliseconds; defaults to `Date.now`. */
  readonly now?: () => number;
}

/** An {@link IdempotencyStore} over a `Map`, for a spec that has no store. */
export const makeInMemoryIdempotencyStore = ({
  retentionMs,
  now = Date.now,
}: IdempotencyStoreOptions): IdempotencyStore & {
  readonly records: ReadonlyMap<string, IdempotencyRecord>;
} => {
  const records = new Map<string, IdempotencyRecord>();
  const live = (dedupKey: string) => {
    const record = records.get(dedupKey);
    return record !== undefined && Date.parse(record.expiresAt) > now()
      ? record
      : undefined;
  };
  return {
    records,
    claim: (dedupKey, fingerprint) =>
      Effect.sync(() => {
        const existing = live(dedupKey);
        if (existing !== undefined)
          return { _tag: 'existing' as const, record: existing };
        records.set(dedupKey, {
          dedupKey,
          fingerprint,
          state: 'inFlight',
          expiresAt: new Date(now() + retentionMs).toISOString(),
        });
        return { _tag: 'claimed' as const };
      }),
    complete: (dedupKey, response) =>
      Effect.sync(() => {
        const existing = records.get(dedupKey);
        if (existing !== undefined)
          records.set(dedupKey, { ...existing, state: 'completed', response });
      }),
    release: dedupKey =>
      Effect.sync(() => {
        records.delete(dedupKey);
      }),
  };
};
