import type {
  IdempotencyClaim,
  IdempotencyRecord,
  IdempotencyStore,
  StoredResponse,
} from '@entifix/business';
import { Effect } from 'effect';
import type { Db } from 'mongodb';

import { translateMongoError } from '../errors/translate-mongo-error.js';

/**
 * Where a route remembers the requests it answered under an `Idempotency-Key`,
 * in the database its own writes go to.
 */
export const IDEMPOTENCY_COLLECTION = 'idempotency';

/** The stored shape: `expiresAt` is a `Date`, which is what a TTL index reads. */
interface IdempotencyDocument {
  readonly dedupKey: string;
  readonly fingerprint: string;
  readonly state: 'inFlight' | 'completed';
  readonly response?: StoredResponse;
  readonly expiresAt: Date;
}

const toRecord = ({
  dedupKey,
  fingerprint,
  state,
  response,
  expiresAt,
}: IdempotencyDocument): IdempotencyRecord => ({
  dedupKey,
  fingerprint,
  state,
  ...(response === undefined ? {} : { response }),
  expiresAt: expiresAt.toISOString(),
});

const isDuplicateKey = (error: unknown): boolean =>
  typeof error === 'object' &&
  error !== null &&
  (error as { code?: unknown }).code === 11000;

/**
 * The unique index the claim rides, and the TTL index that reaps an expired
 * record. The TTL monitor runs about once a minute, so a record can outlive
 * `expiresAt` briefly — which is why a claim also treats an expired record it
 * meets as absent rather than trusting the reaper.
 */
export const ensureIdempotencyIndexes = (db: Db) =>
  Effect.tryPromise({
    try: async () => {
      const collection = db.collection(IDEMPOTENCY_COLLECTION);
      await collection.createIndex({ dedupKey: 1 }, { unique: true });
      await collection.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });
    },
    catch: error => translateMongoError(error),
  });

export interface MongoIdempotencyOptions {
  /** How long a record lives, in milliseconds — a dial from the composition root. */
  readonly retentionMs: number;
  /** The clock, in epoch milliseconds. */
  readonly now?: () => number;
}

/** Mongo-backed {@link IdempotencyStore} over one database. */
export const makeMongoIdempotencyStore = (
  db: Db,
  { retentionMs, now = Date.now }: MongoIdempotencyOptions,
): IdempotencyStore => {
  const collection = db.collection<IdempotencyDocument>(IDEMPOTENCY_COLLECTION);
  const fresh = (
    dedupKey: string,
    fingerprint: string,
  ): IdempotencyDocument => ({
    dedupKey,
    fingerprint,
    state: 'inFlight',
    expiresAt: new Date(now() + retentionMs),
  });

  return {
    claim: (dedupKey, fingerprint) =>
      Effect.tryPromise({
        try: async (): Promise<IdempotencyClaim> => {
          try {
            await collection.insertOne(fresh(dedupKey, fingerprint));
            return { _tag: 'claimed' };
          } catch (error) {
            if (!isDuplicateKey(error)) throw error;
          }
          // Taken. An expired holder is replaced by a conditional write, so of
          // two requests meeting one expired record exactly one gets the key.
          const replaced = await collection.updateOne(
            { dedupKey, expiresAt: { $lte: new Date(now()) } },
            { $set: fresh(dedupKey, fingerprint), $unset: { response: '' } },
          );
          if (replaced.modifiedCount === 1) return { _tag: 'claimed' };
          const existing = await collection.findOne(
            { dedupKey },
            { projection: { _id: 0 } },
          );
          if (existing !== null)
            return { _tag: 'existing', record: toRecord(existing) };
          // Released between the insert and this read: the key is free again.
          // One more insert takes it; losing that race too surfaces as the
          // duplicate key it is, not as a claim nobody holds.
          await collection.insertOne(fresh(dedupKey, fingerprint));
          return { _tag: 'claimed' };
        },
        catch: error => translateMongoError(error),
      }),
    complete: (dedupKey, response) =>
      Effect.tryPromise({
        try: () =>
          collection.updateOne(
            { dedupKey },
            { $set: { state: 'completed', response } },
          ),
        catch: error => translateMongoError(error),
      }).pipe(Effect.asVoid),
    release: dedupKey =>
      Effect.tryPromise({
        try: () => collection.deleteOne({ dedupKey }),
        catch: error => translateMongoError(error),
      }).pipe(Effect.asVoid),
  };
};
