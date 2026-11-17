import { randomUUID } from 'node:crypto';

import type { EntityRepository } from '@entifix/business';
import {
  declaresRevision,
  deserializeEntityCollection,
  deserializeSingleEntity,
  Entity,
  EntityConstructor,
  EntityId,
  EntityLoadRequest,
  EntityPage,
  extractMetaEntity,
  NotFound,
  readRevision,
  serializeEntity,
  StaleRevision,
} from '@entifix/core';
import { Effect } from 'effect';
import type { ClientSession, Db } from 'mongodb';

import { translateMongoError } from '../errors/translate-mongo-error.js';
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

/**
 * The collections whose unique index on `id` is known to exist, per database.
 * A create is atomic only against that index: two concurrent creates of one
 * client-minted id would otherwise both insert. Keyed on the `Db` so a fake or
 * a reset database starts clean, and a rejected attempt is forgotten so the
 * next create tries again.
 */
const ensuredIdIndexes = new WeakMap<Db, Set<string>>();

const ensureIdIndex = (db: Db, name: string) =>
  Effect.suspend(() => {
    const ensured = ensuredIdIndexes.get(db) ?? new Set<string>();
    ensuredIdIndexes.set(db, ensured);
    if (ensured.has(name)) return Effect.void;
    return Effect.tryPromise({
      try: () => db.collection(name).createIndex({ id: 1 }, { unique: true }),
      catch: error => translateMongoError(error),
    }).pipe(Effect.tap(() => Effect.sync(() => ensured.add(name))));
  });

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
 * categorised failures — `NotFound`, `DuplicateKey`, `Unavailable` and the
 * rest — through `translateMongoError`.
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
  const collectionName = mongoCollectionName(entityConstructor);
  const collection = db.collection(collectionName);
  // Spread into every call, so a repository with no session passes none.
  const inSession = options?.session ? { session: options.session } : {};

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
        catch: error => translateMongoError(error),
      });
      const total = yield* Effect.tryPromise({
        try: () => collection.countDocuments(filter, inSession),
        catch: error => translateMongoError(error),
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
        catch: error => translateMongoError(error),
      });
      const entity = yield* deserializeSingleEntity(entityConstructor, doc);
      if (entity === undefined) {
        return yield* Effect.fail(
          new NotFound({ entity: extractMetaEntity(entityConstructor).key }),
        );
      }
      return entity as unknown as T;
    });

  const revised = declaresRevision(entityConstructor);

  /**
   * A save of an entity that declares a revision (ADR 0032): a create that
   * never overwrites, or one conditional write on the revision the caller read.
   * Never a read followed by a write — two saves would both read `n`.
   */
  const saveRevised = <T extends Entity>(entity: T) =>
    Effect.gen(function* () {
      const key = extractMetaEntity(entityConstructor).key;
      const doc = serializeEntity(
        entityConstructor,
        entity as unknown as TEntity,
      );
      const read = readRevision(entity);
      const id = entity.id ?? randomUUID();
      if (read === undefined) {
        yield* ensureIdIndex(db, collectionName);
        yield* Effect.tryPromise({
          try: () =>
            collection.insertOne({ ...doc, id, revision: 1 }, inSession),
          catch: error => translateMongoError(error),
        }).pipe(
          Effect.mapError(failure =>
            failure._tag === 'DuplicateKey'
              ? new StaleRevision({ entity: key })
              : failure,
          ),
        );
        entity.id = id;
        (entity as { revision?: number }).revision = 1;
        return entity;
      }
      const result = yield* Effect.tryPromise({
        try: () =>
          collection.replaceOne(
            { id, revision: read },
            { ...doc, id, revision: read + 1 },
            inSession,
          ),
        catch: error => translateMongoError(error),
      });
      if (result.matchedCount === 0) {
        // The write already decided; this read only names the refusal.
        const stored = yield* Effect.tryPromise({
          try: () =>
            collection.findOne(
              { id },
              { projection: { _id: 0, revision: 1 }, ...inSession },
            ),
          catch: error => translateMongoError(error),
        });
        return yield* stored === null
          ? Effect.fail(new NotFound({ entity: key }))
          : Effect.fail(
              new StaleRevision({
                entity: key,
                current: readRevision(stored),
              }),
            );
      }
      entity.id = id;
      (entity as { revision?: number }).revision = read + 1;
      return entity;
    });

  const save = <T extends Entity>(entity: T) =>
    revised ? saveRevised(entity) : saveUnchecked(entity);

  const saveUnchecked = <T extends Entity>(entity: T) =>
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
        catch: error => translateMongoError(error),
      });
      entity.id = id;
      return entity;
    });

  const del = <T extends Entity>(entityOrId: EntityId | T) =>
    Effect.gen(function* () {
      const id = toEntityId(entityOrId);
      yield* Effect.tryPromise({
        try: () => collection.deleteOne({ id }, inSession),
        catch: error => translateMongoError(error),
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
