import { EntifixConnError, serializeEntity } from '@entifix/core';
import { Order } from '@entifix/example-service-domain';
import { MongoClientTag, MongoDatabaseTag } from '@entifix/mongo';
import {
  isDuplicateKey,
  OUTBOX_COLLECTION,
  outboxDocument,
} from '@entifix/mongo/transactions';
import {
  defineSaga,
  isSagaCall,
  LocalSagaDispatcherLayer,
  type LocalSagaParticipant,
  type LocalSagaRequest,
  type SagaResponse,
} from '@entifix/transactions';
import { Effect, Layer } from 'effect';
import type { ClientSession, Db, MongoClient } from 'mongodb';

export const ORDERS_SLICE = 'orders';
export const ORDER_PLACED = 'order.placed';
export const RESERVATION_COLLECTION = 'reservation';
export const STOCK_COLLECTION = 'stock-item';
export const ORDER_COLLECTION = 'order';

/**
 * Placing an order, as a saga whose three participants all live in this service.
 *
 * - **reserve** holds stock with a conditional decrement. Compensatable: its
 *   compensation gives the units back.
 * - **charge** takes the money. The pivot: nothing before it may be irreversible
 *   and nothing after it is undone. Simulated, refusing above a limit.
 * - **confirm** writes the order and announces it, in one Mongo transaction
 *   with the outbox entry. Retriable: after the charge, it must happen.
 *
 * Every participant is keyed on the command id it is dispatched with, so a flow
 * resumed after a crash — or an order request retried with the same idempotency
 * key — repeats no side effect.
 */
export const placeOrder = defineSaga({
  name: 'place-order',
  permission: 'orders:order:write',
  steps: [
    {
      id: 'reserve',
      participant: 'stock',
      command: { method: 'POST', path: '/reservation' },
      compensation: {
        method: 'DELETE',
        path: '/reservation/{outcome.reservationId}',
      },
      kind: 'compensatable',
    },
    {
      id: 'charge',
      participant: 'payment',
      command: { method: 'POST', path: '/charge' },
      kind: 'pivot',
    },
    {
      id: 'confirm',
      participant: 'orders',
      command: { method: 'POST', path: '/order' },
      kind: 'retriable',
    },
  ],
});

export interface PlaceOrderRequest {
  readonly sku: string;
  readonly quantity: number;
  readonly amount: number;
}

/** What each step is dispatched with. */
export const placeOrderInputs = (sagaId: string, order: PlaceOrderRequest) => ({
  reserve: [{ body: { sku: order.sku, quantity: order.quantity } }],
  charge: [{ body: { amount: order.amount } }],
  confirm: [{ body: { ...order, sagaId } }],
});

const ok = (status: number, body: unknown): SagaResponse => ({
  ok: true,
  status,
  body,
});
const refused = (status: number, code: string): SagaResponse => ({
  ok: false,
  status,
  body: { code },
});

/** Thrown inside a transaction to abort it with a business refusal. */
class Refusal extends Error {
  readonly response: SagaResponse;

  constructor(response: SagaResponse) {
    super('refused');
    this.response = response;
  }
}

/**
 * Runs `work` in one Mongo transaction and answers what it answers.
 *
 * A duplicate key means the command already happened — every participant
 * inserts a record keyed on its command id first — so it answers the way the
 * first run did. A {@link Refusal} rolls back and becomes that refusal.
 */
const transactionally = (
  client: MongoClient,
  work: (session: ClientSession) => Promise<SagaResponse>,
  onDuplicate: SagaResponse,
) =>
  Effect.tryPromise({
    try: async () => {
      const session = client.startSession();
      try {
        let response: SagaResponse = onDuplicate;
        await session.withTransaction(async () => {
          response = await work(session);
        });
        return response;
      } finally {
        await session.endSession();
      }
    },
    catch: error => error,
  }).pipe(
    Effect.catchAll(error =>
      error instanceof Refusal
        ? Effect.succeed(error.response)
        : isDuplicateKey(error)
          ? Effect.succeed(onDuplicate)
          : Effect.fail(new EntifixConnError('participant failed', error)),
    ),
  );

const bodyOf = (request: LocalSagaRequest) =>
  request.body as Record<string, unknown>;

const stock =
  (client: MongoClient, db: Db): LocalSagaParticipant =>
  request => {
    if (isSagaCall(request, { method: 'POST', path: '/reservation' })) {
      const { sku, quantity } = bodyOf(request) as {
        sku: string;
        quantity: number;
      };
      const held = ok(201, { reservationId: request.commandId });
      return transactionally(
        client,
        async session => {
          await db
            .collection(RESERVATION_COLLECTION)
            .insertOne({ id: request.commandId, sku, quantity }, { session });
          const taken = await db
            .collection(STOCK_COLLECTION)
            .updateOne(
              { sku, available: { $gte: quantity } },
              { $inc: { available: -quantity } },
              { session },
            );
          if (taken.matchedCount === 0) {
            throw new Refusal(refused(409, 'insufficientStock'));
          }
          return held;
        },
        held,
      );
    }

    // The compensation. Releasing a hold that is already gone answers success:
    // a compensation redelivered must not strand a flow that was reversed.
    const reservationId = decodeURIComponent(
      request.call.path.slice('/reservation/'.length),
    );
    return transactionally(
      client,
      async session => {
        // A read and a delete, safe inside the transaction: a second release of
        // the same hold aborts on the write conflict and is retried, finding
        // nothing.
        const reservation = await db
          .collection(RESERVATION_COLLECTION)
          .findOne({ id: reservationId }, { session });
        if (reservation !== null) {
          await db
            .collection(RESERVATION_COLLECTION)
            .deleteOne({ id: reservationId }, { session });
          await db
            .collection(STOCK_COLLECTION)
            .updateOne(
              { sku: reservation['sku'] },
              { $inc: { available: reservation['quantity'] as number } },
              { session },
            );
        }
        return ok(200, { released: reservation !== null });
      },
      ok(200, { released: false }),
    );
  };

const payment =
  (chargeLimit: number): LocalSagaParticipant =>
  request => {
    const { amount } = bodyOf(request) as { amount: number };
    return Effect.succeed(
      amount > chargeLimit
        ? refused(402, 'chargeRefused')
        : ok(201, { chargeId: request.commandId, amount }),
    );
  };

const orders =
  (client: MongoClient, db: Db): LocalSagaParticipant =>
  request => {
    const { sagaId, sku, quantity, amount } = bodyOf(request) as unknown as {
      sagaId: string;
    } & PlaceOrderRequest;
    const confirmed = ok(201, { orderId: sagaId });

    return transactionally(
      client,
      async session => {
        const order = Object.assign(new Order(), {
          id: sagaId,
          sku,
          quantity,
          amount,
          status: 'confirmed',
          sagaId,
        });
        await db
          .collection(ORDER_COLLECTION)
          .insertOne({ ...serializeEntity(Order, order) }, { session });
        // Written in the order's own transaction: the event and the write it
        // announces land together or not at all (r10c ADR 0028).
        await db.collection(OUTBOX_COLLECTION).insertOne(
          outboxDocument({
            name: ORDER_PLACED,
            id: `${sagaId}:placed`,
            source: ORDERS_SLICE,
            at: new Date().toISOString(),
            correlationId: sagaId,
            data: { orderId: sagaId, sku, quantity, amount },
          }),
          { session },
        );
        return confirmed;
      },
      confirmed,
    );
  };

/** The saga's participants, answered in this process. */
export const PlaceOrderDispatcherLayer = (chargeLimit: number) =>
  Layer.unwrapEffect(
    Effect.gen(function* () {
      const client = yield* MongoClientTag;
      const db = yield* MongoDatabaseTag;
      return LocalSagaDispatcherLayer({
        stock: stock(client, db),
        payment: payment(chargeLimit),
        orders: orders(client, db),
      });
    }),
  );

/**
 * Unique ids on everything a participant inserts, which is what turns a
 * repeated command into a duplicate key instead of a second side effect.
 */
export const ensureOrderIndexes = (db: Db) =>
  Effect.tryPromise({
    try: async () => {
      await db
        .collection(RESERVATION_COLLECTION)
        .createIndex({ id: 1 }, { unique: true });
      await db
        .collection(ORDER_COLLECTION)
        .createIndex({ id: 1 }, { unique: true });
      await db
        .collection(STOCK_COLLECTION)
        .createIndex({ sku: 1 }, { unique: true });
    },
    catch: error =>
      new EntifixConnError('Failed to ensure order indexes', error),
  });
