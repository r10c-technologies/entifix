import type { EntityRepository, RepositoryFailure } from '@entifix/business';
import {
  applyFiltering,
  applySorting,
  declaresRevision,
  deserializeSingleEntity,
  type EntifixFailure,
  type Entity,
  type EntityConstructor,
  type EntityId,
  type EntityLoadRequest,
  type EntityPage,
  extractMetaAccessors,
  extractMetaEntity,
  NotFound,
  readRevision,
  serializeEntity,
  StaleRevision,
} from '@entifix/core';
import { Effect } from 'effect';

/**
 * A copy of `entity` that shares no state with it.
 *
 * Through the entity's own mapping — serialize, then deserialize — because that
 * is what a real adapter does to every record on the way in and out: a caller
 * can never hold the instance the store keeps, and a member the mapping drops
 * (`hidden`, `readonly`) does not survive a save here either. A class that
 * declares no accessors has no mapping to go through, so it is copied member by
 * member instead; plain spec fixtures are the case this keeps working.
 */
const copyOf = <TEntity extends Entity>(
  entity: TEntity,
): Effect.Effect<TEntity, EntifixFailure> => {
  const entityConstructor = entity.constructor as EntityConstructor<TEntity>;
  if (extractMetaAccessors(entityConstructor).length === 0) {
    return Effect.succeed(
      Object.assign(
        Object.create(Object.getPrototypeOf(entity) as object) as TEntity,
        entity,
      ),
    );
  }
  // `undefined` only comes back for `null`/`undefined` input, and
  // `serializeEntity` always hands over an object.
  return deserializeSingleEntity(
    entityConstructor,
    serializeEntity(entityConstructor, entity),
  ) as Effect.Effect<TEntity, EntifixFailure>;
};

export interface InMemoryEntityRepository extends EntityRepository {
  /** Everything currently stored, in insertion order. */
  readonly items: Entity[];
  /** Replaces the contents, discarding whatever was there. */
  seed(items: Entity[]): void;
  /**
   * Makes the next call to any method fail with `error`, so error branches are
   * reachable without reaching for a mocking library.
   */
  failNext(error: RepositoryFailure): void;
}

/**
 * In-memory {@link EntityRepository}: the default double for anything that
 * depends on persistence.
 *
 * Its semantics deliberately mirror `makeMongoRepository` — the same filtering
 * and sorting rules, which it takes from core's in-memory query evaluation
 * rather than keeping a copy of its own, same 1-based paging with a default page size of 10, same
 * "entity not found" failure, same id minting on create — and
 * `describeEntityRepositoryContract` holds both to that shared contract.
 */
export const makeInMemoryEntityRepository = (
  seed: Entity[] = [],
): InMemoryEntityRepository => {
  let items = [...seed];
  let pendingFailure: RepositoryFailure | undefined;

  /** Consumes a queued failure, if one was armed. */
  const guard = <TValue>(
    run: () => Effect.Effect<TValue, RepositoryFailure>,
  ): Effect.Effect<TValue, RepositoryFailure> => {
    if (pendingFailure !== undefined) {
      const failure = pendingFailure;
      pendingFailure = undefined;
      return Effect.fail(failure);
    }
    return run();
  };

  const load = <TEntity extends Entity>(request: EntityLoadRequest<TEntity>) =>
    guard(() => {
      const matched = applySorting(
        applyFiltering(items as TEntity[], request.filtering),
        request.sorting,
      );
      const page = request.page ?? 1;
      const pageSize = request.pageSize ?? 10;
      const start = (page - 1) * pageSize;

      return Effect.forEach(
        matched.slice(start, start + pageSize),
        copyOf,
      ).pipe(
        Effect.map(
          copies =>
            ({
              items: copies,
              total: matched.length,
              request,
            }) satisfies EntityPage<TEntity>,
        ),
      );
    });

  const get = <TEntity extends Entity>(id: EntityId) =>
    guard(() => {
      const found = items.find(item => item.id === id);
      return found === undefined
        ? Effect.fail(new NotFound({}))
        : copyOf(found as TEntity);
    });

  /**
   * The revision rule (ADR 0032): a create never overwrites, an update names
   * the revision it read, and a mismatch writes nothing. The decision and the
   * write share one synchronous step, so two saves cannot both pass at one
   * revision — the property the adapters get from one conditional statement.
   */
  const saveRevised = <TEntity extends Entity>(entity: TEntity) => {
    const key = extractMetaEntity(
      entity.constructor as EntityConstructor<TEntity>,
    ).key;
    entity.id = entity.id ?? globalThis.crypto.randomUUID();
    return copyOf(entity).pipe(
      Effect.flatMap(stored =>
        Effect.suspend(() => {
          const read = readRevision(entity);
          const index = items.findIndex(item => item.id === stored.id);
          if (read === undefined) {
            if (index !== -1) {
              return Effect.fail(new StaleRevision({ entity: key }));
            }
          } else {
            if (index === -1) return Effect.fail(new NotFound({ entity: key }));
            const current = readRevision(items[index]);
            if (current !== read) {
              return Effect.fail(new StaleRevision({ entity: key, current }));
            }
          }
          const next = (read ?? 0) + 1;
          (stored as { revision?: number }).revision = next;
          (entity as { revision?: number }).revision = next;
          if (index === -1) items.push(stored);
          else items[index] = stored;
          return copyOf(stored);
        }),
      ),
    );
  };

  const save = <TEntity extends Entity>(entity: TEntity) =>
    guard(() =>
      declaresRevision(entity.constructor as EntityConstructor<TEntity>)
        ? saveRevised(entity)
        : storeCopy(entity),
    );

  const storeCopy = <TEntity extends Entity>(entity: TEntity) =>
    Effect.suspend(() => {
      // A create arrives without an id, so the store mints one — same rule the
      // Mongo adapter follows. The Web Crypto global rather than `node:crypto`,
      // because a browser bundle cannot resolve a `node:` import and an example
      // with no backend runs this repository in the page.
      entity.id = entity.id ?? globalThis.crypto.randomUUID();
      // The store keeps its own copy and hands back another, so neither the
      // caller's instance nor the returned one can change the record without a
      // second save — which a real adapter guarantees by construction.
      return copyOf(entity).pipe(
        Effect.tap(stored =>
          Effect.sync(() => {
            const index = items.findIndex(item => item.id === stored.id);
            if (index === -1) {
              items.push(stored);
            } else {
              items[index] = stored;
            }
          }),
        ),
        Effect.flatMap(copyOf),
      );
    });

  const remove = <TEntity extends Entity>(entityOrId: EntityId | TEntity) =>
    guard(() => {
      const id =
        entityOrId != null && typeof entityOrId === 'object'
          ? entityOrId.id
          : entityOrId;
      items = items.filter(item => item.id !== id);
      return Effect.succeed(undefined);
    });

  return {
    load,
    get,
    save,
    delete: remove,
    get items() {
      return items;
    },
    seed: (next: Entity[]) => {
      items = [...next];
    },
    failNext: (error: RepositoryFailure) => {
      pendingFailure = error;
    },
    // Each method closes over its own state, so nothing is required from the
    // Effect environment; that is assignable to the interface's channel.
  } as unknown as InMemoryEntityRepository;
};
