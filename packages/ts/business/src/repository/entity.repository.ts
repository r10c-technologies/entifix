import type {
  EntifixError,
  Entity,
  EntityId,
  EntityLoadRequest,
  EntityPage,
} from '@entifix/core';
import { Context } from 'effect';
import { Effect } from 'effect/Effect';

/**
 * Where a use case reads and writes one entity's records.
 *
 * ⚠️ **Every method requires nothing from its environment.** An adapter that
 * needs something to do its job — a REST client's base URL, a database handle —
 * binds it when the adapter is built, so the port says only what every adapter
 * has in common. A requirement here would be one adapter's mechanism leaked into
 * every use case, and every caller of a static or in-memory adapter would have
 * to provide a value it never reads.
 */
export interface EntityRepository {
  get<TEntity extends Entity>(id: EntityId): Effect<TEntity, EntifixError>;
  load<TEntity extends Entity>(
    request: EntityLoadRequest<TEntity>,
  ): Effect<EntityPage<TEntity>, EntifixError>;
  save<TEntity extends Entity>(entity: TEntity): Effect<TEntity, EntifixError>;
  delete<TEntity extends Entity>(
    entityOrId: EntityId | TEntity,
  ): Effect<void, EntifixError>;
}

export class EntityRepositoryTag extends Context.Service<
  EntityRepositoryTag,
  EntityRepository
>()('EntityRepositoryTag') {}
