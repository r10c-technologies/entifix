import { EntityLinkResolverTag } from '@entifix/business';
import {
  Entity,
  EntityConstructor,
  EntityLinkResolver,
  Internal,
  type TransitionalFailure,
} from '@entifix/core';
import { Context, Effect } from 'effect';
import type { Db } from 'mongodb';

import { makeMongoRepository } from './make-mongo-repository.js';

/**
 * Builds an {@link EntityLinkResolverTag} context backed by Mongo repositories,
 * so a load use-case can materialize not-yet-loaded {@link EntityLink}s on the
 * backend. Mirrors the REST `createEntityLinkResolver`, but each Mongo `get`
 * already has no outstanding requirements, so nothing needs to be provided.
 *
 * `registrations` lists the link-target constructors this resolver can fetch.
 */
export function makeMongoLinkResolver(
  db: Db,
  registrations: ReadonlyArray<EntityConstructor<Entity>>,
): Context.Context<EntityLinkResolverTag> {
  const repositoryByConstructor = new Map(
    registrations.map(
      entityConstructor =>
        [
          entityConstructor,
          makeMongoRepository(db, entityConstructor),
        ] as const,
    ),
  );

  const resolver: EntityLinkResolver = {
    resolve(entityConstructor, id) {
      const repository = repositoryByConstructor.get(
        entityConstructor as EntityConstructor<Entity>,
      );
      if (!repository) {
        return Effect.fail(new Internal());
      }
      return repository.get(id) as unknown as Effect.Effect<
        never,
        TransitionalFailure
      >;
    },
  };

  return Context.make(EntityLinkResolverTag, resolver);
}
