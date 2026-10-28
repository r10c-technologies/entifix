import {
  EntityRepositoryFactoryTag,
  type TenantDatabaseResolver,
  TenantDatabaseResolverTag,
} from '@entifix/business';
import { Internal } from '@entifix/core';
import { Effect, Layer } from 'effect';
import type { Db } from 'mongodb';

import { MongoDatabaseTag } from '../mongo-database/mongo-database.js';
import { makeMongoRepository } from './make-mongo-repository.js';

/**
 * Repositories over the service's one database, whoever the request is for.
 */
export const MongoRepositoryFactoryLayer = Layer.effect(
  EntityRepositoryFactoryTag,
  Effect.gen(function* () {
    const db = yield* MongoDatabaseTag;
    return {
      for: entityConstructor =>
        Effect.succeed(makeMongoRepository(db, entityConstructor)),
    };
  }),
);

/**
 * Repositories over the requesting organization's own database, resolved per
 * request through the host's {@link TenantDatabaseResolverTag}.
 *
 * ⚠️ A request that names no organization is **refused**, never served from a
 * default: on a per-organization store a default database is some other
 * organization's.
 */
export const MongoTenantRepositoryFactoryLayer = Layer.effect(
  EntityRepositoryFactoryTag,
  Effect.gen(function* () {
    const resolver =
      (yield* TenantDatabaseResolverTag) as TenantDatabaseResolver<Db>;
    return {
      for: (entityConstructor, scope) =>
        scope.organizationId === undefined
          ? Effect.fail(new Internal())
          : Effect.map(resolver.forOrganization(scope.organizationId), db =>
              makeMongoRepository(db, entityConstructor),
            ),
    };
  }),
);
