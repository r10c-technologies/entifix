import {
  EntityFacetCounterFactoryTag,
  type TenantDatabaseResolver,
  TenantDatabaseResolverTag,
} from '@entifix/business';
import { Internal } from '@entifix/core';
import { Effect, Layer } from 'effect';
import type { Db } from 'mongodb';

import { MongoDatabaseTag } from '../mongo-database/mongo-database.js';
import { makeMongoFacetCounter } from './make-mongo-facet-counter.js';

/**
 * Facet counters over the service's one database, whoever the request is for —
 * `MongoRepositoryFactoryLayer`'s counterpart, bound beside it.
 */
export const MongoFacetCounterFactoryLayer = Layer.effect(
  EntityFacetCounterFactoryTag,
  Effect.gen(function* () {
    const db = yield* MongoDatabaseTag;
    return {
      for: entityConstructor =>
        Effect.succeed(makeMongoFacetCounter(db, entityConstructor)),
    };
  }),
);

/**
 * Facet counters over the requesting organization's own database, resolved
 * per request through the host's {@link TenantDatabaseResolverTag}.
 *
 * ⚠️ A request that names no organization is **refused**, never counted from a
 * default: on a per-organization store a default database is some other
 * organization's, and its counts would say how much stock a competitor holds.
 */
export const MongoTenantFacetCounterFactoryLayer = Layer.effect(
  EntityFacetCounterFactoryTag,
  Effect.gen(function* () {
    const resolver =
      (yield* TenantDatabaseResolverTag) as TenantDatabaseResolver<Db>;
    return {
      for: (entityConstructor, scope) =>
        scope.organizationId === undefined
          ? Effect.fail(new Internal())
          : Effect.map(resolver.forOrganization(scope.organizationId), db =>
              makeMongoFacetCounter(db, entityConstructor),
            ),
    };
  }),
);
