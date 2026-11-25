import type {
  EntifixFailure,
  Entity,
  EntityId,
  EntityLoadRequest,
  EntityPage,
  UseCaseAvailability,
} from '@entifix/core';
import { Context } from 'effect';
import { Effect } from 'effect/Effect';

/**
 * What a repository fails with while the adapters move to typed failures
 * ([ADR 0013](../../../../../docs/adr/0013-failures-are-typed-values-decided-at-the-shell.md)):
 * the old class tree, or a categorised failure — an `InvalidEnvelope` from a
 * transport, a `DuplicateKey` from a store.
 */
export type RepositoryFailure = EntifixFailure;

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
/**
 * How a write is conditioned beyond its revision.
 *
 * `expect` names the states the stored record must hold for the write to
 * happen — an entity's `writableWhen` on an update, its `deletableWhen` on a
 * delete ([ADR 0029](../../../../../docs/adr/0029-a-verb-declares-the-states-it-is-legal-from.md)).
 * An adapter conjoins it onto the write itself, never a read followed by a
 * write, and answers `UnavailableInState` when the record is in another one.
 *
 * ⚠️ A save with `expect` is an **update**: it never creates. A record that is
 * not there answers `NotFound`; a delete of one that is not there still
 * succeeds, as an unconditioned delete does.
 */
export interface EntityWriteOptions {
  readonly expect?: UseCaseAvailability;
}

export interface EntityRepository {
  get<TEntity extends Entity>(id: EntityId): Effect<TEntity, RepositoryFailure>;
  load<TEntity extends Entity>(
    request: EntityLoadRequest<TEntity>,
  ): Effect<EntityPage<TEntity>, RepositoryFailure>;
  save<TEntity extends Entity>(
    entity: TEntity,
    options?: EntityWriteOptions,
  ): Effect<TEntity, RepositoryFailure>;
  delete<TEntity extends Entity>(
    entityOrId: EntityId | TEntity,
    options?: EntityWriteOptions,
  ): Effect<void, RepositoryFailure>;
}

export class EntityRepositoryTag extends Context.Service<
  EntityRepositoryTag,
  EntityRepository
>()('EntityRepositoryTag') {}
