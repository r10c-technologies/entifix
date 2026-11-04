import { AmqpHealthProbeLayer, AmqpLayer } from '@entifix/amqp';
import { AmqpEventBusLayer } from '@entifix/amqp/transactions';
import {
  MongoDatabaseLayer,
  MongoDatabaseTag,
  MongoHealthProbeLayer,
  MongoRepositoryFactoryLayer,
} from '@entifix/mongo';
import {
  ensureOutboxIndexes,
  makeMongoOutbox,
  startOutboxRelay,
} from '@entifix/mongo/transactions';
import { makeObservabilityLayer } from '@entifix/service-shell/observability';
import {
  AllowAllPolicyLayer,
  FixedTokenServiceLayer,
} from '@entifix/testing-auth';
import {
  EventSourceTag,
  OutboxMaxAttempts,
  OutboxTag,
} from '@entifix/transactions';
import {
  InMemoryBulkheadLayer,
  InMemoryCircuitBreakerLayer,
  InMemoryRetryBudgetLayer,
} from '@entifix/transactions/engine';
import {
  FlowStatusStoreTag,
  makeInMemoryFlowStatusStore,
  MemoryFlowEngineLayer,
} from '@entifix/workflow';
import { Effect, Layer } from 'effect';

import { startOrderStatsProjection } from './order-stats.projection.ts';
import {
  ensureOrderIndexes,
  ORDERS_SLICE,
  placeOrderCatalog,
  PlaceOrderParticipantsLayer,
} from './place-order.flow.ts';
import type { ServiceSettings } from './settings.ts';

export const SERVICE_NAME = 'example-service';

/**
 * The service's domain layer on top of any connections that provide Mongo and
 * AMQP — real ones in `main.ts`, the drivers' fakes in the e2e mock profile.
 *
 * ⚠️ **The auth layers trust every token.** `@entifix/testing-auth` exists so an
 * example can guard its routes without an identity provider; a real service
 * passes its own `TokenServiceTag` and `PolicyDecisionTag` here and nothing
 * else changes.
 */
export const makeDomainLayer = (settings: ServiceSettings) => {
  const infra = Layer.mergeAll(
    FixedTokenServiceLayer(),
    AllowAllPolicyLayer,
    Layer.succeed(EventSourceTag, ORDERS_SLICE),
    Layer.succeed(OutboxMaxAttempts, 5),
  );

  // The flow engine, in memory: what this example proves is the composition —
  // a durable fleet puts `@entifix/workflow/postgres` here and nothing else
  // changes. Its
  // announcements leave through the same Mongo outbox as the order's.
  const flows = MemoryFlowEngineLayer({
    catalog: placeOrderCatalog,
    source: ORDERS_SLICE,
  }).pipe(
    Layer.provide(
      Layer.mergeAll(
        InMemoryCircuitBreakerLayer(),
        InMemoryBulkheadLayer(),
        InMemoryRetryBudgetLayer(),
        Layer.succeed(FlowStatusStoreTag, makeInMemoryFlowStatusStore()),
        Layer.effect(OutboxTag, Effect.map(MongoDatabaseTag, makeMongoOutbox)),
        PlaceOrderParticipantsLayer(settings.chargeLimit),
      ),
    ),
  );

  const domain = Layer.mergeAll(MongoRepositoryFactoryLayer, flows);

  const started = Layer.effectDiscard(
    Effect.gen(function* () {
      yield* ensureOutboxIndexes(yield* MongoDatabaseTag);
      yield* ensureOrderIndexes(yield* MongoDatabaseTag);
      yield* startOutboxRelay();
      yield* startOrderStatsProjection;
    }),
  );

  return Layer.provideMerge(
    started,
    Layer.provideMerge(Layer.mergeAll(domain, AmqpEventBusLayer), infra),
  );
};

/** Real connections, probes and telemetry around the domain layer. */
export const makeAppLayer = (settings: ServiceSettings) =>
  Layer.merge(
    makeObservabilityLayer({
      serviceName: SERVICE_NAME,
      level: 'info',
      sink: settings.otelEndpoint === undefined ? 'stdout' : 'otlp',
      otelEndpoint: settings.otelEndpoint,
    }),
    Layer.provideMerge(
      makeDomainLayer(settings),
      Layer.provideMerge(
        Layer.mergeAll(
          MongoHealthProbeLayer([ORDERS_SLICE]),
          AmqpHealthProbeLayer,
        ),
        Layer.mergeAll(
          MongoDatabaseLayer({
            uri: settings.mongoUri,
            dbName: settings.mongoDb,
          }),
          AmqpLayer({ uri: settings.amqpUri }),
        ),
      ),
    ),
  ).pipe(Layer.orDie);
