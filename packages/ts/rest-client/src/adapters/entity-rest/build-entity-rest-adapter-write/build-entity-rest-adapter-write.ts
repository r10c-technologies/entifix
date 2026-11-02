import {
  type Entity,
  type EntityConstructor,
  type EntityId,
  extractMetaEntity,
  Internal,
  makeEntityEnvelope,
  readEntityEnvelope,
  type TransitionalFailure,
  type WriteResult,
} from '@entifix/core';
import { Effect } from 'effect';

import { performHttpRequestThroughFetch } from '../../../clients/fetch/index.js';
import { buildEntityRestAdapterMixins as adapterMixins } from '../build-entity-rest-adapter-mixins/index.js';
import { pendingSaveKeys } from '../pending-save-keys.js';
import { readWriteResponse } from '../read-write-response.js';
import type { BuildEntityRestOptions } from '../types.js';

/**
 * An entity's writes as a screen makes them: each answers {@link WriteResult},
 * settled on `200`/`201` or pending on `202 flowAccepted`, so the server can
 * move a write onto a flow without the screen changing
 * ([ADR 0022](../../../../../../docs/adr/0022-two-settle-modes-and-the-pending-flow-store.md)).
 */
export interface EntityRestWrite {
  /**
   * Creates an entity without an id with `POST`; updates one with an id with
   * the configured `update` method. A settled save answers the stored entity.
   */
  save<TInput extends Entity>(
    entity: TInput,
  ): Effect.Effect<WriteResult<TInput>, TransitionalFailure>;
  /** Deletes by id or by entity. A settled delete answers nothing. */
  delete(
    entityOrId: EntityId | Entity,
  ): Effect.Effect<WriteResult<void>, TransitionalFailure>;
}

const idOf = (entityOrId: EntityId | Entity): EntityId =>
  entityOrId != null && typeof entityOrId === 'object'
    ? entityOrId.id
    : entityOrId;

/**
 * The write half of an entity's REST adapters, answering both settle modes.
 *
 * The `command` create protocol is the tracker's and is not served here; it
 * stays on `buildEntityRestAdapterSave`.
 */
export const buildEntityRestAdapterWrite = <TEntity extends Entity>(
  entityConstructor: EntityConstructor<TEntity>,
  { uriConfig, update = 'PUT', configuration }: BuildEntityRestOptions,
): EntityRestWrite => {
  const metaEntity = extractMetaEntity(entityConstructor);
  const key = metaEntity.key ?? metaEntity.name;
  const urlOf = (id?: EntityId) =>
    adapterMixins.buildEntityBaseUrl(
      configuration,
      { uriConfig },
      key,
      id == null ? undefined : String(id),
    );

  return {
    save: <TInput extends Entity>(entity: TInput) =>
      Effect.gen(function* () {
        const isCreate = entity.id == null;
        const url = yield* urlOf(entity.id);
        const idempotencyKey =
          pendingSaveKeys.get(entity) ?? crypto.randomUUID();
        pendingSaveKeys.set(entity, idempotencyKey);

        const response = yield* performHttpRequestThroughFetch(
          adapterMixins.buildEntityRequest({
            method: isCreate ? 'POST' : update,
            url,
            envelope: makeEntityEnvelope(
              entityConstructor,
              entity as unknown as TEntity,
            ),
            idempotencyKey,
          }),
        );
        const result = yield* readWriteResponse(response, body =>
          Effect.map(
            readEntityEnvelope(entityConstructor, body),
            saved => saved as unknown as TInput,
          ),
        );
        pendingSaveKeys.delete(entity);
        return result;
      }),
    delete: entityOrId =>
      Effect.gen(function* () {
        const id = idOf(entityOrId);
        if (id == null) return yield* Effect.fail(new Internal());
        const response = yield* performHttpRequestThroughFetch(
          adapterMixins.buildEntityRequest({
            method: 'DELETE',
            url: yield* urlOf(id),
          }),
        );
        return yield* readWriteResponse(response, () => Effect.void);
      }),
  };
};
