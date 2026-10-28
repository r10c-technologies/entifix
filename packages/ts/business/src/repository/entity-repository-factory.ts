import type {
  Entity,
  EntityConstructor,
  Internal,
  Invalid,
  StoreFailure,
} from '@entifix/core';
import { Context, type Effect } from 'effect';

import type { EntityRepository } from './entity.repository.js';

/**
 * Who a repository is being opened for. A request on a per-organization store
 * names its organization; a request on a single store names nothing.
 */
export interface RepositoryScope {
  readonly organizationId?: string;
}

/**
 * Opens the {@link EntityRepository} for one entity, for one request.
 *
 * What lets generic code — a route derived from an entity, a sweep — reach
 * storage without knowing which store, which engine or which database it is.
 * The host provides one at composition: a single database for a platform
 * store, a per-organization resolver for a tenant one. Calling it is cheap; it
 * hands out handles over a pool that already exists.
 *
 * An implementation over a per-organization store **must refuse** a scope with
 * no `organizationId` rather than pick a default: a default organization is
 * somebody else's data.
 */
export interface EntityRepositoryFactory {
  readonly for: <T extends Entity>(
    entityConstructor: EntityConstructor<T>,
    scope: RepositoryScope,
  ) => Effect.Effect<EntityRepository, StoreFailure | Invalid | Internal>;
}

export class EntityRepositoryFactoryTag extends Context.Service<
  EntityRepositoryFactoryTag,
  EntityRepositoryFactory
>()('EntityRepositoryFactoryTag') {}
