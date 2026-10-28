import { EntityIdTag } from '@entifix/business';
import { Entity, EntityId,type TransitionalFailure } from '@entifix/core';
import { Context, Effect } from 'effect';

export interface UseEntityRecordState<TEntity extends Entity> {
  entity: TEntity | undefined;
  isLoading: boolean;
  error: TransitionalFailure | undefined;
}

export type UseEntityRecordAction<TEntity extends Entity> = {
  set: Partial<UseEntityRecordState<TEntity>>;
};

export interface UseEntityRecordOptions<TEntity extends Entity, TContext> {
  /** A get use-case; the hook supplies {@link EntityIdTag}. */
  uc: Effect.Effect<TEntity, TransitionalFailure, EntityIdTag | TContext>;
  ctx: Context.Context<TContext>;
  /**
   * The record to load. `undefined` means "nothing to load yet" — the create
   * case — and the hook stays idle rather than fetching.
   */
  id: EntityId;
}
