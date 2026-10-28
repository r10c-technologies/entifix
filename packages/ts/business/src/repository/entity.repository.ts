import type {
  Entity,
  EntityId,
  EntityLoadRequest,
  EntityPage,
  TransitionalFailure,
} from '@entifix/core';
import { Context } from 'effect';
import { Effect } from 'effect/Effect';

/**
 * What a repository fails with while the adapters move to typed failures
 * ([ADR 0013](../../../../../docs/adr/0013-failures-are-typed-values-decided-at-the-shell.md)):
 * the old class tree, or a categorised failure — an `InvalidEnvelope` from a
 * transport, a `DuplicateKey` from a store.
 */
export type RepositoryFailure = TransitionalFailure;

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
  get<TEntity extends Entity>(id: EntityId): Effect<TEntity, RepositoryFailure>;
  load<TEntity extends Entity>(
    request: EntityLoadRequest<TEntity>,
  ): Effect<EntityPage<TEntity>, RepositoryFailure>;
  save<TEntity extends Entity>(
    entity: TEntity,
  ): Effect<TEntity, RepositoryFailure>;
  delete<TEntity extends Entity>(
    entityOrId: EntityId | TEntity,
  ): Effect<void, RepositoryFailure>;
}

export class EntityRepositoryTag extends Context.Service<
  EntityRepositoryTag,
  EntityRepository
>()('EntityRepositoryTag') {}
