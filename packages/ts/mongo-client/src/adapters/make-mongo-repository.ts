import { randomUUID } from 'node:crypto';

import type { EntityRepository, EntityWriteOptions } from '@entifix/business';
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
  holdsStoredState,
  NotFound,
  readRevision,
  relevanceLabelKey,
  relevanceTerms,
  serializeEntity,
  StaleRevision,
  type StoredStateCondition,
  storedStateCondition,
  unavailableInState,
  type UniqueMember,
  uniqueMembersOf,
} from '@entifix/core';
import { Effect } from 'effect';
import type { ClientSession, Db } from 'mongodb';

import { translateMongoError } from '../errors/translate-mongo-error.js';
import {
  RELEVANCE_FIELD,
  relevanceExpression,
  translateFiltering,
  translateSorting,
} from './filter-translator.js';

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
 * The collections whose unique indexes are known to exist, per database: the
 * one on `id`, and one per member the entity declares `unique` (ADR 0034).
 *
 * A create is atomic only against an index: two concurrent creates of one
 * client-minted id — or of one vendor's code — would otherwise both insert.
 * Keyed on the `Db` so a fake or a reset database starts clean, and a rejected
 * attempt is forgotten so the next write tries again.
 */
const ensuredIndexes = new WeakMap<Db, Set<string>>();

/** The index a unique member is held to: named for the member, partial. */
export const uniqueIndexName = (member: UniqueMember): string =>
  `unique_${member.key}`;

const ensureIndexes = (
  db: Db,
  name: string,
  uniques: readonly UniqueMember[],
) =>
  Effect.suspend(() => {
    const ensured = ensuredIndexes.get(db) ?? new Set<string>();
    ensuredIndexes.set(db, ensured);
    if (ensured.has(name)) return Effect.void;
    const collection = db.collection(name);
    return Effect.tryPromise({
      try: async () => {
        await collection.createIndex({ id: 1 }, { unique: true });
        // Partial over the documents that hold a value of the member's type,
        // so an optional member left empty never collides with another.
        for (const member of uniques) {
          await collection.createIndex(
            { [member.key]: 1 },
            {
              unique: true,
              name: uniqueIndexName(member),
              partialFilterExpression: { [member.key]: { $type: member.type } },
            },
          );
        }
      },
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
  const uniques = uniqueMembersOf(entityConstructor);
  // Every write is held to the unique members' indexes, not only a create: an
  // update onto another record's value collides exactly as a create does.
  const indexed =
    uniques.length === 0
      ? Effect.void
      : ensureIndexes(db, collectionName, uniques);
  // Spread into every call, so a repository with no session passes none.
  const inSession = options?.session ? { session: options.session } : {};

  const load = <T extends Entity>(request: EntityLoadRequest<T>) =>
    Effect.gen(function* () {
      const filter = translateFiltering(request.filtering);
      const sort = translateSorting(request.sorting);
      const page = request.page ?? 1;
      const pageSize = request.pageSize ?? 10;
      const skip = (page - 1) * pageSize;

      // A relevance order is a field computed from the request's own words,
      // which a `find` cannot sort by: the same page through a pipeline
      // (ADR 0033).
      const docs = yield* Effect.tryPromise({
        try: () =>
          RELEVANCE_FIELD in sort
            ? collection
                .aggregate(
                  [
                    { $match: filter },
                    {
                      $addFields: {
                        [RELEVANCE_FIELD]: relevanceExpression(
                          relevanceLabelKey(entityConstructor),
                          relevanceTerms(request.filtering),
                        ),
                      },
                    },
                    { $sort: sort },
                    { $skip: skip },
                    { $limit: pageSize },
                    { $project: { _id: 0, [RELEVANCE_FIELD]: 0 } },
                  ],
                  inSession,
                )
                .toArray()
            : collection
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

  /** The `expect` of a write, resolved to the field the store holds it under. */
  const conditionOf = (
    options: EntityWriteOptions | undefined,
  ): StoredStateCondition | undefined =>
    options?.expect === undefined
      ? undefined
      : storedStateCondition(entityConstructor, options.expect);

  /** The filter clause a condition adds to a write. */
  const stateFilter = (condition: StoredStateCondition | undefined) =>
    condition === undefined
      ? {}
      : { [condition.key]: { $in: [...condition.in] } };

  /** What a write that matched nothing reads back, only to name the refusal. */
  const readBack = (id: EntityId, condition?: StoredStateCondition) =>
    Effect.tryPromise({
      try: () =>
        collection.findOne(
          { id },
          {
            projection: {
              _id: 0,
              revision: 1,
              ...(condition === undefined ? {} : { [condition.key]: 1 }),
            },
            ...inSession,
          },
        ),
      catch: error => translateMongoError(error),
    });

  /**
   * A save of an entity that declares a revision (ADR 0032): a create that
   * never overwrites, or one conditional write on the revision the caller read.
   * Never a read followed by a write — two saves would both read `n`.
   */
  const saveRevised = <T extends Entity>(
    entity: T,
    condition: StoredStateCondition | undefined,
  ) =>
    Effect.gen(function* () {
      const key = extractMetaEntity(entityConstructor).key;
      const doc = serializeEntity(
        entityConstructor,
        entity as unknown as TEntity,
      );
      const read = readRevision(entity);
      const id = entity.id ?? randomUUID();
      if (read === undefined) {
        yield* ensureIndexes(db, collectionName, uniques);
        yield* Effect.tryPromise({
          try: () =>
            collection.insertOne({ ...doc, id, revision: 1 }, inSession),
          catch: error => translateMongoError(error),
        }).pipe(
          // Only the identity's index means "someone created it first"; a
          // unique member's names the member, which a form shows on the field.
          Effect.mapError(failure =>
            failure._tag === 'DuplicateKey' && failure.key === 'id'
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
            { id, revision: read, ...stateFilter(condition) },
            { ...doc, id, revision: read + 1 },
            inSession,
          ),
        catch: error => translateMongoError(error),
      });
      if (result.matchedCount === 0) {
        // The write already decided; this read only names the refusal. A
        // record in another state is refused for its state before its
        // revision: a fresher read would not make the save legal.
        const stored = yield* readBack(id, condition);
        if (stored === null) return yield* new NotFound({ entity: key });
        if (condition !== undefined && !holdsStoredState(condition, stored)) {
          return yield* unavailableInState(
            entityConstructor,
            condition,
            stored,
          );
        }
        return yield* Effect.fail(
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

  const save = <T extends Entity>(entity: T, options?: EntityWriteOptions) => {
    const condition = conditionOf(options);
    const write = revised
      ? saveRevised(entity, condition)
      : condition === undefined
        ? saveUnchecked(entity)
        : saveConditioned(entity, condition);
    return Effect.andThen(indexed, write);
  };

  /**
   * An update of a record that declares no revision, on the states it must
   * hold: one `replaceOne` on the id and the state, never an upsert — a save
   * with `expect` is an update of a stored record.
   */
  const saveConditioned = <T extends Entity>(
    entity: T,
    condition: StoredStateCondition,
  ) =>
    Effect.gen(function* () {
      const key = extractMetaEntity(entityConstructor).key;
      const doc = serializeEntity(
        entityConstructor,
        entity as unknown as TEntity,
      );
      const id = entity.id;
      if (id === undefined) return yield* new NotFound({ entity: key });
      const result = yield* Effect.tryPromise({
        try: () =>
          collection.replaceOne(
            { id, ...stateFilter(condition) },
            { ...doc, id },
            inSession,
          ),
        catch: error => translateMongoError(error),
      });
      if (result.matchedCount === 0) {
        const stored = yield* readBack(id, condition);
        return yield* stored === null
          ? Effect.fail(new NotFound({ entity: key }))
          : Effect.fail(
              unavailableInState(entityConstructor, condition, stored),
            );
      }
      return entity;
    });

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

  const del = <T extends Entity>(
    entityOrId: EntityId | T,
    options?: EntityWriteOptions,
  ) =>
    Effect.gen(function* () {
      const id = toEntityId(entityOrId);
      const condition = conditionOf(options);
      const result = yield* Effect.tryPromise({
        try: () =>
          collection.deleteOne({ id, ...stateFilter(condition) }, inSession),
        catch: error => translateMongoError(error),
      });
      if (condition === undefined || result.deletedCount > 0) return;
      // Nothing deleted: either nothing was there, which a delete accepts,
      // or the record is in a state it may not be deleted from.
      const stored = yield* readBack(id, condition);
      if (stored !== null) {
        return yield* unavailableInState(entityConstructor, condition, stored);
      }
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
