import { EntityIdTag, EntityTag } from '@entifix/business';
import { Entity,type TransitionalFailure } from '@entifix/core';
import { Context, Effect } from 'effect';

export interface UseEntityMutationState {
  isSaving: boolean;
  isDeleting: boolean;
  error: TransitionalFailure | undefined;
}

export type UseEntityMutationAction = {
  set: Partial<UseEntityMutationState>;
};

export interface UseEntityMutationOptions<TEntity extends Entity, TContext> {
  /** A save use-case; the hook supplies {@link EntityTag}. */
  saveUc: Effect.Effect<TEntity, TransitionalFailure, EntityTag | TContext>;
  /** A delete use-case; the hook supplies {@link EntityIdTag}. */
  deleteUc: Effect.Effect<void, TransitionalFailure, EntityIdTag | TContext>;
  ctx: Context.Context<TContext>;
}
