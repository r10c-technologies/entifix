import type { Effect } from 'effect';

import type { TransitionalFailure } from '../failure/failure.js';
import type { Entity, EntityId } from '../types/Entity.js';
import type { WriteResult } from './write-result.js';

/**
 * An entity's writes as a screen makes them. Each answers {@link WriteResult},
 * settled when the write happened or pending when the server handed it to a
 * flow, so the server can move a write onto a flow without the screen
 * changing
 * ([ADR 0022](../../../../../docs/adr/0022-two-settle-modes-and-the-pending-flow-store.md)).
 *
 * A port: the REST adapter is one implementation, and a screen names it only
 * through the host's composition.
 */
export interface EntityWriter {
  /**
   * Creates an entity without an id and updates one with an id. A settled
   * save answers the stored entity.
   */
  save<TInput extends Entity>(
    entity: TInput,
  ): Effect.Effect<WriteResult<TInput>, TransitionalFailure>;
  /** Deletes by id or by entity. A settled delete answers nothing. */
  delete(
    entityOrId: EntityId | Entity,
  ): Effect.Effect<WriteResult<void>, TransitionalFailure>;
}
