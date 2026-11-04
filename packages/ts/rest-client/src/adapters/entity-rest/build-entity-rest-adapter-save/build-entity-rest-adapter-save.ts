import {
  Entity,
  EntityConstructor,
  extractMetaEntity,
  ProtocolFailure,
} from '@entifix/core';
import { Effect } from 'effect';

import { buildEntityRestAdapterWrite } from '../build-entity-rest-adapter-write/index.js';
import { BuildEntityRestOptions } from '../types.js';

/**
 * Persists an entity over HTTP.
 *
 * An entity without an id has never been stored, so it is created with `POST`
 * against the collection; one with an id is replaced with `PUT` against its own
 * URL.
 *
 * For a plain create the response envelope — not the request — is what gets
 * deserialized and returned, because the service is the authority on the stored
 * entity (it assigns ids and may normalize fields).
 *
 * A write the service hands to a flow answers `202`; a repository save has no
 * stored entity to return for it, so such an entity is written through
 * `buildEntityRestAdapterWrite`, which answers the flow to follow.
 */
export const buildEntityRestAdapterSave =
  <TEntity extends Entity>(
    entityConstructor: EntityConstructor<TEntity>,
    options: BuildEntityRestOptions,
  ) =>
  // Deliberately not shadowing `TEntity` here (as the read builders do): the
  // envelope has to be built against the *constructor's* entity type, which a
  // shadowed parameter would make unreachable.
  <TInput extends Entity>(entity: TInput) =>
    Effect.gen(function* () {
      const metaEntity = extractMetaEntity(entityConstructor);
      const key = metaEntity.key ?? metaEntity.name;
      const result = yield* buildEntityRestAdapterWrite(
        entityConstructor,
        options,
      ).save(entity);
      // A repository save answers the stored entity, so it has nothing to
      // return for a write the service handed to a flow; a screen writes such
      // an entity through `buildEntityRestAdapterWrite` instead.
      if (result._tag === 'pending')
        return yield* new ProtocolFailure({
          reason: `'${key}' answered a save with 202 flowAccepted; write it through buildEntityRestAdapterWrite`,
        });
      return result.value;
    });
