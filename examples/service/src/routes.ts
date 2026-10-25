import { StockItem } from '@entifix/example-service-domain';
import { MongoDatabaseTag } from '@entifix/mongo';
import { makeEntityRoutes, requirePermission } from '@entifix/service-shell';
import { SagaStoreTag } from '@entifix/transactions';
import { runSaga } from '@entifix/transactions/engine';
import { Effect, Layer } from 'effect';
import { HttpRouter, HttpServerRequest, HttpServerResponse } from 'effect/http';

import { STATS_COLLECTION } from './order-stats.projection.ts';
import {
  placeOrder,
  placeOrderInputs,
  type PlaceOrderRequest,
} from './place-order.saga.ts';

const failure = (status: number, code: string, detail?: unknown) =>
  HttpServerResponse.json({ code, detail: String(detail ?? '') }, { status });

/**
 * The generated CRUD half: one flat entity, its list, read and update — and
 * its `$metadata` — derived from the entity and bound to the Mongo repository
 * factory the app layer provides. A stock item is created by being put at its
 * code, so there is no `create` and no `delete`.
 */
const stockRoutes = makeEntityRoutes(StockItem, {
  verbs: ['list', 'get', 'update'],
  guard: { kind: 'permission' },
});

/**
 * Places an order by running the saga.
 *
 * `Idempotency-Key` becomes the saga id: a retried request re-runs the same
 * flow, whose every command is keyed on it, so nothing happens twice and the
 * answer is the same.
 */
const postOrder = requirePermission(placeOrder.permission as never)(() =>
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const body = (yield* request.json) as unknown as PlaceOrderRequest;
    const sagaId =
      request.headers['idempotency-key'] ?? globalThis.crypto.randomUUID();

    const result = yield* runSaga({
      sagaId,
      definition: placeOrder,
      inputs: placeOrderInputs(sagaId, body),
    });

    const status =
      result.state === 'COMPLETED'
        ? 201
        : result.state === 'COMPENSATED'
          ? 409
          : 500;
    return yield* HttpServerResponse.json(
      { sagaId, state: result.state, error: result.error },
      { status },
    );
  }).pipe(Effect.catch(error => failure(500, 'unexpected', error))),
);

const getSaga = Effect.gen(function* () {
  const { id } = yield* HttpRouter.params;
  const store = yield* SagaStoreTag;
  const instance = yield* store.get(id ?? '');
  return instance === undefined
    ? yield* failure(404, 'notFound')
    : yield* HttpServerResponse.json(instance);
}).pipe(Effect.catch(error => failure(500, 'unexpected', error)));

const getStats = Effect.gen(function* () {
  const db = yield* MongoDatabaseTag;
  const totals = yield* Effect.tryPromise(() =>
    db
      .collection(STATS_COLLECTION)
      .findOne({ id: 'totals' }, { projection: { _id: 0 } }),
  );
  return yield* HttpServerResponse.json(totals ?? { orders: 0, units: 0 });
}).pipe(Effect.catch(error => failure(500, 'unexpected', error)));

/**
 * The routes. `/api/health*` and `/api/$service` come from `makeService`; the
 * stock item's come from its entity, and the rest are written by hand beside
 * them.
 */
export const router = Layer.mergeAll(
  stockRoutes,
  HttpRouter.addAll([
    HttpRouter.route('POST', '/api/order', postOrder),
    HttpRouter.route('GET', '/api/saga/:id', getSaga),
    HttpRouter.route('GET', '/api/order-stats', getStats),
  ]),
);
