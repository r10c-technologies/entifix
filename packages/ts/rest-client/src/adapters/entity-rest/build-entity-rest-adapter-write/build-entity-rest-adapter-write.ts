import {
  declaresRevision,
  type Entity,
  type EntityConstructor,
  type EntityId,
  type EntityWriter,
  extractMetaEntity,
  Internal,
  makeEntityEnvelope,
  readEntityEnvelope,
  readRevision,
} from '@entifix/core';
import { Effect } from 'effect';

import { performHttpRequestThroughFetch } from '../../../clients/fetch/index.js';
import { buildEntityRestAdapterMixins as adapterMixins } from '../build-entity-rest-adapter-mixins/index.js';
import { pendingSaveKeys } from '../pending-save-keys.js';
import { readWriteResponse } from '../read-write-response.js';
import type { BuildEntityRestOptions } from '../types.js';

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
): EntityWriter => {
  const metaEntity = extractMetaEntity(entityConstructor);
  const key = metaEntity.key ?? metaEntity.name;
  // A declared entity is created by the absence of a revision, not of an id: a
  // client-minted id is sent with `POST`, which the service accepts, rather
  // than as a `PUT` it would refuse (ADR 0032).
  const revised = declaresRevision(entityConstructor);
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
        const isCreate = revised
          ? readRevision(entity) === undefined
          : entity.id == null;
        const url = yield* urlOf(isCreate ? undefined : entity.id);
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
