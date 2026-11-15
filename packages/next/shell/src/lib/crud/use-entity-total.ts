'use client';

import {
  EntityLoadRequestTag,
  type EntityRepositoryTag,
  loadUCFactory,
} from '@entifix/business';
import type {
  Entity,
  EntityConstructor,
  EntityFiltering,
  EntityLoadRequest,
  FilterGroup,
} from '@entifix/core';
import { entityQueryScope } from '@entifix/react-integration';
import { useQuery } from '@tanstack/react-query';
import { Context, Effect } from 'effect';

export interface UseEntityTotalOptions<TEntity extends Entity> {
  /** The entity counted; its query scope is the count's, so a push refreshes it. */
  readonly entity: EntityConstructor<TEntity>;
  /** Where its records are read. Without one nothing is counted and the count stays loading. */
  readonly ctx: Context.Context<EntityRepositoryTag> | undefined;
  /** Which records count — "awaiting dispatch". All of them when omitted. */
  readonly filtering?: FilterGroup<TEntity>;
}

/** A count in the shape a summary tile takes it. */
export interface EntityTotal {
  readonly state: 'loading' | 'ready' | 'failed';
  /** How many records match, once read. */
  readonly total: number | undefined;
  /** Reads the count again. */
  readonly retry: () => void;
}

/**
 * How many records of an entity match a filtering, read as a one-record page
 * whose `total` is the answer — the list's own read, so the same narrowing and
 * the same authorization apply. Keyed under the entity's query scope: a pushed
 * change to that entity, or a write through its list, refreshes the count.
 */
export function useEntityTotal<TEntity extends Entity>({
  entity,
  ctx,
  filtering,
}: UseEntityTotalOptions<TEntity>): EntityTotal {
  // The repository behind the tag reads any entity's records, so the request
  // crosses it untyped — exactly as the list's own read does.
  const request: EntityLoadRequest = {
    ...(filtering === undefined
      ? {}
      : { filtering: [filtering as unknown as EntityFiltering<Entity>] }),
    page: 1,
    pageSize: 1,
  };
  const { data, isError, refetch } = useQuery({
    enabled: ctx !== undefined,
    queryKey: [...entityQueryScope(entity), '$total', request],
    queryFn: () =>
      Effect.runPromise(
        Effect.provide(
          loadUCFactory<TEntity>(),
          (ctx as Context.Context<EntityRepositoryTag>).pipe(
            Context.add(EntityLoadRequestTag, request),
          ),
        ),
      ).then(page => page.total),
  });
  return {
    state: isError ? 'failed' : data === undefined ? 'loading' : 'ready',
    total: data,
    retry: () => void refetch(),
  };
}
