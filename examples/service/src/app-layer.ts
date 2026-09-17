import { AmqpHealthProbeLayer, AmqpLayer } from '@entifix/amqp';
import { AmqpEventBusLayer } from '@entifix/amqp/transactions';
import { ConfigurationRepositoryTag } from '@entifix/business';
import { ConfigurationClientInMemory } from '@entifix/core';
import {
  MongoDatabaseLayer,
  MongoDatabaseTag,
  MongoHealthProbeLayer,
} from '@entifix/mongo';
import {
  ensureOutboxIndexes,
  MongoSagaStoreLayer,
  OutboxMaxAttempts,
  startOutboxRelay,
} from '@entifix/mongo/transactions';
import { makeObservabilityLayer } from '@entifix/service-shell';
import {
  AllowAllPolicyLayer,
  FixedTokenServiceLayer,
} from '@entifix/testing-auth';
import { EventSourceTag, startSagaResume } from '@entifix/transactions';
import { Effect, Layer } from 'effect';

import { startOrderStatsProjection } from './order-stats.projection.ts';
import {
  ensureOrderIndexes,
  ORDERS_SLICE,
  placeOrder,
  PlaceOrderDispatcherLayer,
} from './place-order.saga.ts';
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
    Layer.succeed(
      ConfigurationRepositoryTag,
      new ConfigurationClientInMemory(),
    ),
    Layer.succeed(EventSourceTag, ORDERS_SLICE),
    Layer.succeed(OutboxMaxAttempts, 5),
  );

  const saga = Layer.mergeAll(
    MongoSagaStoreLayer,
    PlaceOrderDispatcherLayer(settings.chargeLimit),
  );

  const started = Layer.effectDiscard(
    Effect.gen(function* () {
      yield* ensureOutboxIndexes(yield* MongoDatabaseTag);
      yield* ensureOrderIndexes(yield* MongoDatabaseTag);
      yield* startOutboxRelay();
      yield* startOrderStatsProjection;
      yield* startSagaResume({
        definitions: [placeOrder],
        staleAfterMs: 30_000,
        maxResumeAttempts: 5,
        intervalMs: 15_000,
      });
    }),
  );

  return Layer.provideMerge(
    started,
    Layer.provideMerge(Layer.mergeAll(saga, AmqpEventBusLayer), infra),
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
