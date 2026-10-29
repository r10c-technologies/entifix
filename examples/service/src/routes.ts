import { IdempotencyKeyTag } from '@entifix/business';
import {
  defineEndpoint,
  Failure,
  implement,
  Internal,
  JsonBody,
  NotFound,
} from '@entifix/core';
import { StockItem } from '@entifix/example-service-domain';
import { MongoDatabaseTag } from '@entifix/mongo';
import { endpointGroup, entityApi } from '@entifix/service-shell';
import { SagaStoreTag } from '@entifix/transactions';
import { runSaga } from '@entifix/transactions/engine';
import { Effect, Schema } from 'effect';

import { STATS_COLLECTION } from './order-stats.projection.ts';
import { placeOrder, placeOrderInputs } from './place-order.saga.ts';

/**
 * The generated CRUD half: one flat entity, its list, read and update — and
 * its `$metadata` — derived from the entity and bound to the Mongo repository
 * factory the app layer provides. A stock item is created by being put at its
 * code, so there is no `create` and no `delete`.
 */
export const stockItems = entityApi(StockItem, 'stock-item', {
  verbs: ['list', 'get', 'update'],
  guard: { kind: 'permission' },
});

/** The saga ran its compensations: the order did not happen. */
export class OrderRefused extends Failure.conflict<OrderRefused>()(
  'OrderRefused',
  'orderRefused',
  { sagaId: Schema.String, reason: Schema.optionalKey(Schema.String) },
) {}

const placeOrderEndpoint = defineEndpoint({
  name: 'place',
  method: 'POST',
  path: '/api/order',
  payload: Schema.Struct({
    sku: Schema.String,
    quantity: Schema.Number,
    amount: Schema.Number,
  }),
  success: Schema.Struct({
    sagaId: Schema.String,
    state: Schema.Literal('COMPLETED'),
  }),
  errors: [OrderRefused],
  guard: {
    kind: 'permission',
    permission: placeOrder.permission as `${string}:${string}:${string}`,
  },
  idempotent: 'unit',
});

const sagaEndpoint = defineEndpoint({
  name: 'saga',
  method: 'GET',
  path: '/api/saga/:id',
  params: { id: Schema.String },
  success: JsonBody,
  errors: [NotFound],
  guard: { kind: 'public' },
});

const statsEndpoint = defineEndpoint({
  name: 'stats',
  method: 'GET',
  path: '/api/order-stats',
  success: JsonBody,
  errors: [],
  guard: { kind: 'public' },
});

/**
 * The hand-written half: placing an order runs the saga, and its instance and
 * the order stats are read back. `Idempotency-Key` is the saga id, so a
 * retried request re-runs the same flow, whose every command is keyed on it,
 * and nothing happens twice.
 */
export const orders = endpointGroup(
  'orders',
  implement(placeOrderEndpoint, ({ payload }) =>
    Effect.gen(function* () {
      const sagaId = yield* IdempotencyKeyTag;
      const result = yield* runSaga({
        sagaId,
        definition: placeOrder,
        inputs: placeOrderInputs(sagaId, payload),
      }).pipe(Effect.mapError(() => new Internal()));
      if (result.state === 'COMPENSATED')
        return yield* Effect.fail(
          new OrderRefused({
            sagaId,
            ...(result.error === undefined ? {} : { reason: result.error }),
          }),
        );
      if (result.state !== 'COMPLETED')
        return yield* Effect.fail(new Internal());
      return { sagaId, state: 'COMPLETED' as const };
    }),
  ),
  implement(sagaEndpoint, ({ params }) =>
    Effect.gen(function* () {
      const store = yield* SagaStoreTag;
      const instance = yield* store
        .get(params.id)
        .pipe(Effect.mapError(() => new Internal()));
      return instance === undefined
        ? yield* Effect.fail(new NotFound({ entity: 'saga' }))
        : instance;
    }),
  ),
  implement(statsEndpoint, () =>
    Effect.gen(function* () {
      const db = yield* MongoDatabaseTag;
      const totals = yield* Effect.tryPromise({
        try: () =>
          db
            .collection(STATS_COLLECTION)
            .findOne({ id: 'totals' }, { projection: { _id: 0 } }),
        catch: () => new Internal(),
      });
      return totals ?? { orders: 0, units: 0 };
    }),
  ),
);
