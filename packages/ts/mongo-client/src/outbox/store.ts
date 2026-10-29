import type { Outbox, OutboxEntry, OutboxEvent } from '@entifix/transactions';
import { Effect } from 'effect';
import type { Db } from 'mongodb';

import { translateMongoError } from '../errors/translate-mongo-error.js';

/**
 * The outbox collection, and it lives in the **same database as the entity it
 * describes** — never in a shared control-plane store.
 *
 * Two reasons, and the second only shows up later. Same database means the
 * entity write and its event are one single-database transaction, which stays a
 * single-*shard* transaction if this ever shards; a control-plane outbox would
 * be cross-database from the first commit. And an outbox holds event payloads:
 * a `TransactionEvent` carries no tenant data, but `catalog.published` carries a
 * whole offering and `order.placed` a whole receipt, and neither may land in the
 * control plane on its way to the bus.
 *
 * That rule is why this lives here rather than in one service. It applies
 * identically to a per-organization `tenant_<id>` and to a single platform-plane
 * database, and the second publisher is what turned a copy into a seam.
 */
export const OUTBOX_COLLECTION = 'outbox';

/** Drop Mongo's internal `_id` from every read. */
const WITHOUT_MONGO_ID = { projection: { _id: 0 } } as const;

/** Mongo's duplicate-key error, which is how a replayed command is recognised. */
const DUPLICATE_KEY = 11000;

const isDuplicateKey = (error: unknown): boolean =>
  typeof error === 'object' &&
  error !== null &&
  (error as { code?: unknown }).code === DUPLICATE_KEY;

/**
 * The stored shape of an outbox entry.
 *
 * Exported because the `completed` entry is **not** written through the port:
 * it has to join the entity write's session to be atomic with it, and a session
 * cannot live in a framework-free contract. The handler inserts this document
 * itself; everything else goes through {@link makeMongoOutbox}.
 */
export const outboxDocument = (event: OutboxEvent): OutboxEntry => ({
  eventId: event.id,
  aggregate: event.aggregate,
  version: event.version,
  event,
  sent: false,
  // Defaulted here rather than at each write site because there are two of
  // them: the relay's `enqueue`, and the transaction handler's own insert
  // inside the entity's Mongo session. An entry missing `attempts` would sort
  // into `pending` and then fail `attempts + 1` arithmetic on a `undefined`.
  attempts: 0,
  quarantined: false,
  createdAt: event.at,
});

/**
 * Puts a **quarantined** entry back in the queue, and touches nothing else.
 *
 * A rebuild walk's repair for the one failure measured on a live lab: with the
 * broker down long enough, the relay spends `outbox.maxAttempts` on an
 * announcement and quarantines it (the deliberate skip-so-the-head-moves),
 * after which the tenant store reads one thing and the storefront shows another
 * with nothing reporting it. Re-emitting cannot help on its own — the event id is
 * `<offeringId>:<publishedAt>` and the unique index answers `duplicate`.
 *
 * ⚠️ **`quarantined: true` is in the filter, not the update.** An entry that is
 * merely pending keeps its `attempts`, and one already `sent` is never re-sent —
 * which is what keeps this from quietly becoming "re-announce everything", a
 * walk that would re-publish the whole fleet on every boot and un-quarantine
 * genuine poison each time.
 *
 * Not an `Outbox` method: the port is framework-free and shared by
 * every publisher, and this is a repair specific to the rebuild. `outboxDocument`
 * is exported beside it for the same class of reason.
 *
 * Answers whether an entry was actually revived.
 */
export const reviveQuarantined = (db: Db, eventId: string) =>
  Effect.tryPromise({
    try: async () => {
      const result = await db
        .collection<OutboxEntry>(OUTBOX_COLLECTION)
        .updateOne(
          { eventId, quarantined: true },
          {
            $set: { sent: false, quarantined: false, attempts: 0 },
            // The failure that put it here is spent; leaving it would make the
            // next quarantine's log name an error from a different outage.
            $unset: { lastError: '' },
          },
        );
      return result.modifiedCount === 1;
    },
    catch: error => translateMongoError(error),
  });

/**
 * Ensures the three indexes the outbox depends on.
 *
 * The unique one is load-bearing rather than defensive: it *is* the idempotency
 * check behind the client-generated transaction id, so a replayed command is
 * rejected by the storage engine rather than by a read-then-write race. It is on
 * `eventId` — `<transactionId>:<step>` for a transaction — so the claim and the
 * bus's deduplication key are one value rather than two that can drift. The
 * partial one keeps the relay's `pending` query cheap once the collection fills
 * with sent entries; it filters on `quarantined` too, so an entry past its
 * ceiling leaves the index rather than being read and skipped forever.
 *
 * Mongo rejects a `createIndex` that reuses a key pattern with a different
 * `partialFilterExpression` (`IndexOptionsConflict`), and this runs on every
 * sweep and every create. A database that predates the `quarantined` filter
 * therefore fails here on every pass — which is loud only because the sweep now
 * logs what it catches. The fix is `pnpm run <app>:dev:reset`; nothing runs in
 * production, so there is no migration to write.
 */
export const ensureOutboxIndexes = (db: Db) =>
  Effect.tryPromise({
    try: async () => {
      const collection = db.collection(OUTBOX_COLLECTION);
      await collection.createIndex({ eventId: 1 }, { unique: true });
      await collection.createIndex(
        { createdAt: 1 },
        { partialFilterExpression: { sent: false, quarantined: false } },
      );
      // What the per-aggregate order reads, and what a rebuild finds an
      // aggregate's latest announced version by.
      await collection.createIndex({
        'aggregate.type': 1,
        'aggregate.id': 1,
        version: 1,
      });
    },
    catch: error => translateMongoError(error),
  });

/**
 * Mongo-backed {@link Outbox} over one database.
 *
 * `db` is closed over, so every method's Effect has `R = never` — the same
 * technique `makeMongoRepository` uses. There is no publishing here: the relay
 * composes these methods with the event bus, which is what lets the relay be
 * tested without a broker.
 */
export const makeMongoOutbox = (db: Db): Outbox => {
  const collection = db.collection<OutboxEntry>(OUTBOX_COLLECTION);

  return {
    enqueue: event =>
      Effect.tryPromise({
        try: async () => {
          try {
            await collection.insertOne(outboxDocument(event));
            return 'enqueued' as const;
          } catch (error) {
            // Not a failure: the unique index rejected a second claim for this
            // message id, which is precisely how a retry is identified.
            if (isDuplicateKey(error)) {
              return 'duplicate' as const;
            }
            throw error;
          }
        },
        catch: error => translateMongoError(error),
      }),

    pending: limit =>
      Effect.tryPromise({
        // Oldest first, then by version: the relay publishes in this order
        // within each aggregate, so `accepted` reaches the bus before the
        // terminal event of the same transaction.
        try: () =>
          collection
            .find({ sent: false, quarantined: false }, WITHOUT_MONGO_ID)
            .sort({ createdAt: 1, version: 1 })
            .limit(limit)
            .toArray(),
        catch: error => translateMongoError(error),
      }),

    markSent: entry =>
      Effect.tryPromise({
        try: () =>
          collection.updateOne(
            { eventId: entry.eventId },
            { $set: { sent: true } },
          ),
        catch: error => translateMongoError(error),
      }).pipe(Effect.asVoid),

    stats: () =>
      Effect.tryPromise({
        // Two counts and one `findOne`, rather than reading the entries: the
        // pending set can be arbitrarily large when the relay is stuck, which
        // is exactly the moment this must stay cheap. Both queries ride the
        // partial index on `{ createdAt: 1 }` filtered to the same predicate.
        try: async () => {
          const pendingFilter = { sent: false, quarantined: false };
          const [pending, quarantined, oldest] = await Promise.all([
            collection.countDocuments(pendingFilter),
            collection.countDocuments({ quarantined: true }),
            collection.findOne(pendingFilter, {
              sort: { createdAt: 1 },
              projection: { _id: 0, createdAt: 1 },
            }),
          ]);

          return {
            pending,
            quarantined,
            // Absent rather than zero when the outbox is empty: an age of zero
            // and "nothing is waiting" are opposite conditions, and a gauge
            // that reports 0 for both is indistinguishable from a healthy relay
            // at exactly the moment it is not one.
            ...(oldest === null ? {} : { oldestPendingAt: oldest.createdAt }),
          };
        },
        catch: error => translateMongoError(error),
      }),

    recordFailure: (entry, error, quarantine) =>
      Effect.tryPromise({
        // `$inc` rather than a read-modify-write: two relays can be draining the
        // same tenant (the request's inline drain and the daemon sweep), and an
        // absolute write would let one of them lose the other's attempt and
        // stretch the ceiling indefinitely.
        try: () =>
          collection.updateOne(
            { eventId: entry.eventId },
            {
              $inc: { attempts: 1 },
              $set: { lastError: error, quarantined: quarantine },
            },
          ),
        catch: cause => translateMongoError(cause),
      }).pipe(Effect.asVoid),
  };
};
