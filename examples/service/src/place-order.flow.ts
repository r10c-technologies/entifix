import type { Recipe } from '@entifix/business/compose';
import { defineCatalog, defineFragment } from '@entifix/business/flow';
import {
  Declined,
  type EntifixFailure,
  Internal,
  registerEvent,
  serializeEntity,
  Unavailable,
} from '@entifix/core';
import { Order } from '@entifix/example-service-domain';
import { MongoClientTag, MongoDatabaseTag } from '@entifix/mongo';
import {
  isDuplicateKey,
  OUTBOX_COLLECTION,
  outboxDocument,
} from '@entifix/mongo/transactions';
import {
  type ParticipantCall,
  ParticipantClientTag,
} from '@entifix/transactions';
import { Effect, Layer, Schema } from 'effect';
import type { ClientSession, Db, MongoClient } from 'mongodb';

export const ORDERS_SLICE = 'orders';
export const ORDER_PLACED = 'order.placed';

/**
 * Every event a bus carries is registered with its schema, so a consumer that
 * reads it decodes rather than casts. The projection is the only consumer, and
 * nothing outside the service receives it, so it names no audience.
 */
registerEvent(
  ORDER_PLACED,
  Schema.Struct({
    orderId: Schema.String,
    sku: Schema.String,
    quantity: Schema.Number,
    amount: Schema.Number,
  }),
  { versioned: true, audience: 'none' },
);
export const RESERVATION_COLLECTION = 'reservation';
export const STOCK_COLLECTION = 'stock-item';
export const ORDER_COLLECTION = 'order';

const contract = {
  input: Schema.Unknown,
  output: Schema.Unknown,
  failure: Schema.Unknown,
};

/** Holds stock with a conditional decrement; undone by giving it back. */
export const stockReserve = defineFragment({
  id: 'stock.reserve',
  version: 1,
  module: 'stock',
  kind: 'compensatable',
  participant: 'stock',
  call: { method: 'POST', path: '/reservation' },
  compensation: { method: 'DELETE', path: '/reservation/:reservationId' },
  cardinality: 'one',
  isolation: 'commutative',
  provides: { reservationId: Schema.String },
  contract,
});

/** Takes the money: the pivot. Simulated, refusing above a limit. */
export const paymentCharge = defineFragment({
  id: 'payment.charge',
  version: 1,
  module: 'payment',
  kind: 'pivot',
  participant: 'payment',
  call: { method: 'POST', path: '/charge' },
  cardinality: 'one',
  irreversible: true,
  contract,
});

/** Writes the order and announces it; after the charge, so retried. */
export const ordersConfirm = defineFragment({
  id: 'orders.confirm',
  version: 1,
  module: 'orders',
  kind: 'retriable',
  participant: 'orders',
  call: { method: 'POST', path: '/order' },
  cardinality: 'one',
  isolation: 'reRead',
  contract,
});

/** Every fragment the service composes its flows from. */
export const placeOrderCatalog = defineCatalog([
  stockReserve,
  paymentCharge,
  ordersConfirm,
]);

export const PlaceOrderStart = Schema.Struct({
  orderId: Schema.String,
  sku: Schema.String,
  quantity: Schema.Number,
  amount: Schema.Number,
});
export type PlaceOrderStart = typeof PlaceOrderStart.Type;

/**
 * Placing an order, as a composed flow whose three participants all live in
 * this service: hold the stock, take the money — the pivot — then write the
 * order. Every call is keyed on the step's `Idempotency-Key`, so a flow resumed
 * after a crash repeats no side effect.
 */
export const placeOrderRecipe: Recipe<PlaceOrderStart> = {
  name: 'place-order',
  input: PlaceOrderStart,
  requiresCommitPoint: true,
  stages: [
    {
      name: 'reserve',
      steps: [
        {
          ref: 'stock.reserve@1',
          parameters: (_context, order) => ({
            sku: order.sku,
            quantity: order.quantity,
          }),
        },
      ],
    },
    {
      name: 'charge',
      steps: [
        {
          ref: 'payment.charge@1',
          parameters: (_context, order) => ({ amount: order.amount }),
        },
      ],
    },
    {
      name: 'confirm',
      steps: [
        { ref: 'orders.confirm@1', parameters: (_context, order) => order },
      ],
    },
  ],
};

/** Thrown inside a transaction to abort it with a business refusal. */
class Refusal extends Error {
  readonly failure: EntifixFailure;

  constructor(failure: EntifixFailure) {
    super('refused');
    this.failure = failure;
  }
}

/**
 * Runs `work` in one Mongo transaction and answers what it answers.
 *
 * A duplicate key means the command already happened — every participant
 * inserts a record keyed on its command first — so it answers the way the
 * first run did. A {@link Refusal} rolls back and becomes that refusal.
 */
const transactionally = <T>(
  client: MongoClient,
  work: (session: ClientSession) => Promise<T>,
  onDuplicate: T,
): Effect.Effect<T, EntifixFailure> =>
  Effect.tryPromise({
    try: async () => {
      const session = client.startSession();
      try {
        let answer: T = onDuplicate;
        await session.withTransaction(async () => {
          answer = await work(session);
        });
        return answer;
      } finally {
        await session.endSession();
      }
    },
    catch: error => error,
  }).pipe(
    Effect.catch(error =>
      error instanceof Refusal
        ? Effect.fail(error.failure)
        : isDuplicateKey(error)
          ? Effect.succeed(onDuplicate)
          : Effect.fail(new Unavailable({ dependency: 'mongo' })),
    ),
  );

type Participant = (
  call: ParticipantCall,
) => Effect.Effect<unknown, EntifixFailure>;

const stock =
  (client: MongoClient, db: Db): Participant =>
  ({ kind, inputs, idempotencyKey }) => {
    if (kind === 'action') {
      const { sku, quantity } = inputs as { sku: string; quantity: number };
      const held = { reservationId: idempotencyKey };
      return transactionally(
        client,
        async session => {
          await db
            .collection(RESERVATION_COLLECTION)
            .insertOne({ id: idempotencyKey, sku, quantity }, { session });
          const taken = await db
            .collection(STOCK_COLLECTION)
            .updateOne(
              { sku, available: { $gte: quantity } },
              { $inc: { available: -quantity } },
              { session },
            );
          if (taken.matchedCount === 0) {
            throw new Refusal(new Declined({ reason: 'insufficientStock' }));
          }
          return held;
        },
        held,
      );
    }

    // The compensation, handed the hold its own action took. Releasing a hold
    // that is already gone answers success: a compensation redelivered must
    // not strand a flow that was reversed.
    const reservationId = String(inputs['reservationId']);
    return transactionally(
      client,
      async session => {
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
        return { released: reservation !== null };
      },
      { released: false },
    );
  };

const payment =
  (chargeLimit: number): Participant =>
  ({ inputs, idempotencyKey }) => {
    const { amount } = inputs as { amount: number };
    return amount > chargeLimit
      ? Effect.fail(new Declined({ reason: 'chargeRefused' }))
      : Effect.succeed({ chargeId: idempotencyKey, amount });
  };

const orders =
  (client: MongoClient, db: Db): Participant =>
  ({ inputs }) => {
    const { orderId, sku, quantity, amount } =
      inputs as unknown as PlaceOrderStart;
    const confirmed = { orderId };

    return transactionally(
      client,
      async session => {
        const order = Object.assign(new Order(), {
          id: orderId,
          sku,
          quantity,
          amount,
          status: 'confirmed',
          flowId: orderId,
        });
        await db
          .collection(ORDER_COLLECTION)
          .insertOne({ ...serializeEntity(Order, order) }, { session });
        // Written in the order's own transaction: the event and the write it
        // announces land together or not at all — a relay that publishes from
        // the outbox can then never announce a write that rolled back.
        await db.collection(OUTBOX_COLLECTION).insertOne(
          outboxDocument({
            name: ORDER_PLACED,
            id: `${orderId}:placed`,
            source: ORDERS_SLICE,
            at: new Date().toISOString(),
            correlationId: orderId,
            aggregate: { type: 'order', id: orderId },
            version: 1,
            data: { orderId, sku, quantity, amount },
          }),
          { session },
        );
        return confirmed;
      },
      confirmed,
    );
  };

/**
 * The flow's participants, answered in this process: a {@link ParticipantClientTag}
 * that routes each call by the participant its step names, where a fleet would
 * reach them over HTTP.
 */
export const PlaceOrderParticipantsLayer = (chargeLimit: number) =>
  Layer.effect(
    ParticipantClientTag,
    Effect.gen(function* () {
      const client = yield* MongoClientTag;
      const db = yield* MongoDatabaseTag;
      const participants: Readonly<Record<string, Participant>> = {
        stock: stock(client, db),
        payment: payment(chargeLimit),
        orders: orders(client, db),
      };
      return {
        call: request => {
          const target =
            request.kind === 'action'
              ? request.step.call
              : request.step.compensation;
          if (target === undefined) return Effect.void;
          const participant = participants[request.step.participant ?? ''];
          return participant === undefined
            ? Effect.fail(new Internal())
            : participant(request);
        },
      };
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
    catch: () => new Unavailable({ dependency: 'mongo' }),
  });
