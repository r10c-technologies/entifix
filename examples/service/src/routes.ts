import {
  HttpRouter,
  HttpServerRequest,
  HttpServerResponse,
} from '@effect/platform';
import { permissionForEntity } from '@entifix/authz';
import {
  EntityIdTag,
  EntityLoadRequestTag,
  EntityRepositoryTag,
  EntityTag,
  getUCFactory,
  loadUCFactory,
  saveUCFactory,
} from '@entifix/business';
import {
  EntifixBuildError,
  type EntityLoadRequest,
  makeEntityEnvelope,
  makeEntityPageEnvelope,
  parseLoadRequestParams,
  readEntityEnvelope,
} from '@entifix/core';
import { StockItem } from '@entifix/example-service-domain';
import { makeMongoRepository, MongoDatabaseTag } from '@entifix/mongo';
import { entityMetadataRoute, requirePermission } from '@entifix/service-shell';
import { runSaga, SagaStoreTag } from '@entifix/transactions';
import { Effect } from 'effect';

import { STATS_COLLECTION } from './order-stats.projection.ts';
import {
  placeOrder,
  placeOrderInputs,
  type PlaceOrderRequest,
} from './place-order.saga.ts';

const failure = (status: number, code: string, detail?: unknown) =>
  HttpServerResponse.json({ code, detail: String(detail ?? '') }, { status });

const stockRepository = Effect.map(MongoDatabaseTag, db =>
  makeMongoRepository(db, StockItem),
);

const guard = (action: 'read' | 'write') =>
  requirePermission(permissionForEntity(StockItem, action));

/** The generated CRUD half: one flat entity over the Mongo adapter. */
const listStock = guard('read')(() =>
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const search = new URL(request.url, 'http://localhost').searchParams;
    const load = yield* Effect.try({
      try: () =>
        parseLoadRequestParams(
          StockItem,
          search,
        ) as unknown as EntityLoadRequest,
      catch: error => error as EntifixBuildError,
    });
    const page = yield* loadUCFactory<StockItem>().pipe(
      Effect.provideService(EntityRepositoryTag, yield* stockRepository),
      Effect.provideService(EntityLoadRequestTag, load),
    );
    return yield* HttpServerResponse.json(
      makeEntityPageEnvelope(StockItem, page, []),
    );
  }).pipe(Effect.catchAll(error => failure(400, 'invalidQuery', error))),
);

const getStock = guard('read')(() =>
  Effect.gen(function* () {
    const { id } = yield* HttpRouter.params;
    const item = yield* getUCFactory<StockItem>().pipe(
      Effect.provideService(EntityRepositoryTag, yield* stockRepository),
      Effect.provideService(EntityIdTag, id),
    );
    return yield* HttpServerResponse.json(
      makeEntityEnvelope(StockItem, item, []),
    );
  }).pipe(Effect.catchAll(() => failure(404, 'notFound'))),
);

const putStock = guard('write')(() =>
  Effect.gen(function* () {
    const { id } = yield* HttpRouter.params;
    const request = yield* HttpServerRequest.HttpServerRequest;
    const item = yield* readEntityEnvelope(StockItem, yield* request.json);
    item.id = id;
    const saved = yield* saveUCFactory<StockItem>().pipe(
      Effect.provideService(EntityRepositoryTag, yield* stockRepository),
      Effect.provideService(EntityTag, item),
    );
    return yield* HttpServerResponse.json(
      makeEntityEnvelope(StockItem, saved, []),
    );
  }).pipe(Effect.catchAll(error => failure(400, 'invalidBody', error))),
);

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
  }).pipe(Effect.catchAll(error => failure(500, 'unexpected', error))),
);

const getSaga = Effect.gen(function* () {
  const { id } = yield* HttpRouter.params;
  const store = yield* SagaStoreTag;
  const instance = yield* store.get(id ?? '');
  return instance === undefined
    ? yield* failure(404, 'notFound')
    : yield* HttpServerResponse.json(instance);
}).pipe(Effect.catchAll(error => failure(500, 'unexpected', error)));

const getStats = Effect.gen(function* () {
  const db = yield* MongoDatabaseTag;
  const totals = yield* Effect.tryPromise(() =>
    db
      .collection(STATS_COLLECTION)
      .findOne({ id: 'totals' }, { projection: { _id: 0 } }),
  );
  return yield* HttpServerResponse.json(totals ?? { orders: 0, units: 0 });
}).pipe(Effect.catchAll(error => failure(500, 'unexpected', error)));

/**
 * The routes. `/api/health*` and `/api/$service` come from `makeService`.
 * `$metadata` is registered before `/:id`, which would otherwise swallow it.
 */
export const router = HttpRouter.empty.pipe(
  HttpRouter.get('/api/stock-item', listStock),
  HttpRouter.get('/api/stock-item/$metadata', entityMetadataRoute(StockItem)),
  HttpRouter.get('/api/stock-item/:id', getStock),
  HttpRouter.put('/api/stock-item/:id', putStock),
  HttpRouter.post('/api/order', postOrder),
  HttpRouter.get('/api/saga/:id', getSaga),
  HttpRouter.get('/api/order-stats', getStats),
);
