import { randomUUID } from 'node:crypto';

import type { EntityRepository } from '@entifix/business';
import {
  deserializeEntityCollection,
  deserializeSingleEntity,
  EntifixConnError,
  EntifixError,
  Entity,
  EntityConstructor,
  EntityId,
  EntityLoadRequest,
  EntityPage,
  extractMetaEntity,
  serializeEntity,
} from '@entifix/core';
import { Effect } from 'effect';
import type { ClientSession, Db } from 'mongodb';

import { translateFiltering, translateSorting } from './filter-translator.js';

/** Projection that drops Mongo's internal `_id` from read results. */
const WITHOUT_MONGO_ID = { projection: { _id: 0 } } as const;

/** The collection an entity's records live in: its `key`, else its class name. */
export function mongoCollectionName<TEntity extends Entity>(
  entityConstructor: EntityConstructor<TEntity>,
): string {
  const metaEntity = extractMetaEntity(entityConstructor);
  return metaEntity.key ?? metaEntity.name;
}

function toEntityId(entityOrId: EntityId | Entity): EntityId {
  return entityOrId != null && typeof entityOrId === 'object'
    ? (entityOrId as Entity).id
    : (entityOrId as EntityId);
}

/**
 * Builds an {@link EntityRepository} for a single entity type, backed by a live
 * mongodb {@link Db}. The `db` and `entityConstructor` are captured in closures,
 * so every method's Effect has no outstanding requirements (`R = never`), which
 * is exactly what the interface asks.
 *
 * Collection name = the entity's `key` (falling back to its class name). Reads
 * reuse the shared entifix deserializer (rebuilding links from embedded objects
 * or scalar FKs); writes reuse the shared serializer. Mongo failures surface as
 * {@link EntifixConnError}.
 *
 * This is the Mongo mirror of the REST `buildEntityRestAdapter*` builders.
 *
 * Pass `session` to make the repository part of a transaction — a unit of
 * work's handle — so its writes commit with the unit and its reads see what the
 * unit has already written.
 */
export function makeMongoRepository<TEntity extends Entity>(
  db: Db,
  entityConstructor: EntityConstructor<TEntity>,
  options?: { readonly session?: ClientSession },
): EntityRepository {
  const collection = db.collection(mongoCollectionName(entityConstructor));
  // Spread into every call, so a repository with no session passes none.
  const inSession = options?.session ? { session: options.session } : {};

  const fail = (
    message: string,
    error: unknown,
    details?: Record<string, unknown>,
  ) =>
    new EntifixConnError(message, error, {
      entity: entityConstructor.name,
      ...details,
    });

  const load = <T extends Entity>(request: EntityLoadRequest<T>) =>
    Effect.gen(function* () {
      const filter = translateFiltering(request.filtering);
      const sort = translateSorting(request.sorting);
      const page = request.page ?? 1;
      const pageSize = request.pageSize ?? 10;
      const skip = (page - 1) * pageSize;

      const docs = yield* Effect.tryPromise({
        try: () =>
          collection
            .find(filter, { ...WITHOUT_MONGO_ID, ...inSession })
            .sort(sort)
            .skip(skip)
            .limit(pageSize)
            .toArray(),
        catch: error => fail('Failed to load entities from MongoDB', error),
      });
      const total = yield* Effect.tryPromise({
        try: () => collection.countDocuments(filter, inSession),
        catch: error => fail('Failed to count entities in MongoDB', error),
      });

      const items = yield* deserializeEntityCollection(entityConstructor, docs);

      return {
        items: items as unknown as T[],
        total,
        request,
      } satisfies EntityPage<T>;
    });

  const get = <T extends Entity>(id: EntityId) =>
    Effect.gen(function* () {
      const doc = yield* Effect.tryPromise({
        try: () =>
          collection.findOne({ id }, { ...WITHOUT_MONGO_ID, ...inSession }),
        catch: error =>
          fail('Failed to read entity from MongoDB', error, { id }),
      });
      const entity = yield* deserializeSingleEntity(entityConstructor, doc);
      if (entity === undefined) {
        return yield* Effect.fail(fail(`Entity not found`, undefined, { id }));
      }
      return entity as unknown as T;
    });

  const save = <T extends Entity>(entity: T) =>
    Effect.gen(function* () {
      const doc = serializeEntity(
        entityConstructor,
        entity as unknown as TEntity,
      );
      // A create arrives without an id, so the store mints one. Entities are
      // addressed by their own `id` field (never Mongo's `_id`, which reads
      // project away), so an inserted document without one would be
      // unreachable by `get` and by any later `replaceOne`.
      const id = entity.id ?? randomUUID();
      yield* Effect.tryPromise({
        // `doc` omits `id` when it was undefined (the serializer drops
        // undefined), hence spreading the resolved id back in.
        try: () =>
          collection.replaceOne(
            { id },
            { ...doc, id },
            { upsert: true, ...inSession },
          ),
        catch: error => fail('Failed to save entity to MongoDB', error, { id }),
      });
      entity.id = id;
      return entity;
    });

  const del = <T extends Entity>(entityOrId: EntityId | T) =>
    Effect.gen(function* () {
      const id = toEntityId(entityOrId);
      yield* Effect.tryPromise({
        try: () => collection.deleteOne({ id }, inSession),
        catch: error =>
          fail('Failed to delete entity from MongoDB', error, { id }),
      });
    });

  // Cast through the interface to keep its generic signatures: each method here
  // is written against this entity's type, the interface against any entity's.
  return {
    load,
    get,
    save,
    delete: del,
  } as unknown as EntityRepository;
}

export type { EntifixError };
