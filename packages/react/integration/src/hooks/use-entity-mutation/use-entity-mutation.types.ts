import { EntityIdTag, EntityTag } from '@entifix/business';
import { type EntifixFailure, Entity } from '@entifix/core';
import { Context, Effect } from 'effect';

export interface UseEntityMutationState {
  isSaving: boolean;
  isDeleting: boolean;
  error: EntifixFailure | undefined;
}

export type UseEntityMutationAction = {
  set: Partial<UseEntityMutationState>;
};

export interface UseEntityMutationOptions<TEntity extends Entity, TContext> {
  /** A save use-case; the hook supplies {@link EntityTag}. */
  saveUc: Effect.Effect<TEntity, EntifixFailure, EntityTag | TContext>;
  /** A delete use-case; the hook supplies {@link EntityIdTag}. */
  deleteUc: Effect.Effect<void, EntifixFailure, EntityIdTag | TContext>;
  ctx: Context.Context<TContext>;
}
