import type {
  Entity,
  EntityConstructor,
  EntityFacetCounts,
  EntityFacetQuery,
  Internal,
  Invalid,
  StoreFailure,
} from '@entifix/core';
import { Context, type Effect } from 'effect';

import type { RepositoryFailure } from './entity.repository.js';
import type { RepositoryScope } from './entity-repository-factory.js';

/**
 * Counts how many of one entity's records hold each value of a member — what a
 * facet shows beside each choice ("Aurora (12)").
 *
 * A port of its own rather than a fifth method on `EntityRepository`, so a
 * store that cannot count is simply not bound to it: a route or a read that
 * needs counts then fails to compile for want of the tag, instead of an
 * adapter answering an empty list nobody notices.
 *
 * ⚠️ Like the repository, every method requires nothing from its environment;
 * an adapter binds what it needs when it is built.
 */
export interface EntityFacetCounter {
  count<TEntity extends Entity>(
    queries: readonly EntityFacetQuery<TEntity>[],
  ): Effect.Effect<EntityFacetCounts, RepositoryFailure>;
}

export class EntityFacetCounterTag extends Context.Service<
  EntityFacetCounterTag,
  EntityFacetCounter
>()('EntityFacetCounterTag') {}

/**
 * Opens the {@link EntityFacetCounter} for one entity, for one request — the
 * counter's `EntityRepositoryFactory`, with the same rule: an implementation
 * over a per-organization store **must refuse** a scope with no
 * `organizationId`.
 */
export interface EntityFacetCounterFactory {
  readonly for: <T extends Entity>(
    entityConstructor: EntityConstructor<T>,
    scope: RepositoryScope,
  ) => Effect.Effect<EntityFacetCounter, StoreFailure | Invalid | Internal>;
}

export class EntityFacetCounterFactoryTag extends Context.Service<
  EntityFacetCounterFactoryTag,
  EntityFacetCounterFactory
>()('EntityFacetCounterFactoryTag') {}
