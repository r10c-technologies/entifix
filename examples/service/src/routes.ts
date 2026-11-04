import { defineEntityApi, IdempotencyKeyTag } from '@entifix/business';
import { compose } from '@entifix/business/compose';
import { verifiedContext } from '@entifix/business/verified';
import {
  defineEndpoint,
  implement,
  Internal,
  JsonBody,
  NotFound,
} from '@entifix/core';
import { StockItem } from '@entifix/example-service-domain';
import { MongoDatabaseTag } from '@entifix/mongo';
import { endpointGroup, entityApi } from '@entifix/service-shell';
import { FlowEngineTag } from '@entifix/transactions';
import { Effect, Schema } from 'effect';

import { STATS_COLLECTION } from './order-stats.projection.ts';
import { placeOrderCatalog, placeOrderRecipe } from './place-order.flow.ts';

/**
 * The generated CRUD half: one flat entity, its list, read and update — and
 * its `$metadata` — derived from the entity and bound to the Mongo repository
 * factory the app layer provides. A stock item is created by being put at its
 * code, so there is no `create` and no `delete`.
 */
export const stockItems = entityApi(
  defineEntityApi(StockItem, 'stock-item', {
    verbs: ['list', 'get', 'update'],
    guard: { kind: 'permission' },
  }),
);

const placeOrderEndpoint = defineEndpoint({
  name: 'place',
  method: 'POST',
  path: '/api/order',
  payload: Schema.Struct({
    sku: Schema.String,
    quantity: Schema.Number,
    amount: Schema.Number,
  }),
  success: Schema.Struct({ flowId: Schema.String }),
  errors: [],
  guard: { kind: 'permission', permission: 'orders:order:write' },
  idempotent: 'unit',
  accepted: true,
});

const flowEndpoint = defineEndpoint({
  name: 'flow',
  method: 'GET',
  path: '/api/flow/:id',
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

/** The caller placing an order: a service with no entitlement to state. */
const CALLER = verifiedContext({
  entitlements: [],
  roles: [],
  flags: [],
  config: {},
});

/**
 * The hand-written half: placing an order starts its flow and answers `202`
 * with the flow's id, never its outcome; where the flow stands and the order
 * stats are read back. The engine registers the `Idempotency-Key`, so a
 * retried request names the flow the first one began, and nothing happens
 * twice.
 */
export const orders = endpointGroup(
  'orders',
  implement(placeOrderEndpoint, ({ payload }) =>
    Effect.gen(function* () {
      const key = yield* IdempotencyKeyTag;
      const flowId = globalThis.crypto.randomUUID();
      const slip = yield* compose(
        placeOrderRecipe,
        placeOrderCatalog,
        CALLER,
        { ...payload, orderId: flowId },
        { flowId, composedAt: new Date().toISOString() },
      ).pipe(Effect.mapError(() => new Internal()));
      const engine = yield* FlowEngineTag;
      return yield* engine
        .start(slip, key)
        .pipe(Effect.mapError(() => new Internal()));
    }),
  ),
  implement(flowEndpoint, ({ params }) =>
    Effect.gen(function* () {
      const engine = yield* FlowEngineTag;
      return yield* engine
        .status(params.id)
        .pipe(Effect.mapError(() => new NotFound({ entity: 'flow' })));
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
