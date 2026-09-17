import { queueNameFor } from '@entifix/amqp/transactions';
import { EntifixConnError } from '@entifix/core';
import { MongoClientTag, MongoDatabaseTag } from '@entifix/mongo';
import {
  ensureInboxIndexes,
  INBOX_COLLECTION,
  inboxDocument,
  isDuplicateKey,
} from '@entifix/mongo/transactions';
import { EventBusTag, type Subscription } from '@entifix/transactions';
import { Effect } from 'effect';

import { ORDER_PLACED, ORDERS_SLICE } from './place-order.saga.ts';

export const STATS_COLLECTION = 'order-stats';

/**
 * A consumer of this service's own event, to show the other half of the bus.
 *
 * The event arrives at least once, so the projection claims it in the inbox and
 * applies it in the same transaction: a redelivery hits the unique claim, rolls
 * nothing forward, and is acknowledged.
 */
export const orderPlacedSubscription: Subscription = {
  slice: ORDERS_SLICE,
  pattern: ORDER_PLACED,
  mode: 'work',
  maxAttempts: 5,
};

export const startOrderStatsProjection = Effect.gen(function* () {
  const client = yield* MongoClientTag;
  const db = yield* MongoDatabaseTag;
  const bus = yield* EventBusTag;
  const consumer = queueNameFor(orderPlacedSubscription);

  yield* ensureInboxIndexes(db);

  yield* bus.subscribe(orderPlacedSubscription, event =>
    Effect.tryPromise({
      try: async () => {
        const { quantity } = event.data as { quantity: number };
        const session = client.startSession();
        try {
          await session.withTransaction(async () => {
            await db
              .collection(INBOX_COLLECTION)
              .insertOne(inboxDocument(consumer, event.id), { session });
            await db
              .collection(STATS_COLLECTION)
              .updateOne(
                { id: 'totals' },
                { $inc: { orders: 1, units: quantity } },
                { upsert: true, session },
              );
          });
        } finally {
          await session.endSession();
        }
      },
      catch: error => error,
    }).pipe(
      Effect.catchAll(error =>
        isDuplicateKey(error)
          ? Effect.void
          : Effect.fail(
              new EntifixConnError('Failed to project an order', error, {
                eventId: event.id,
              }),
            ),
      ),
    ),
  );
});
