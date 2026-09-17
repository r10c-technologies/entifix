import type { EntityRepository } from '@entifix/business';
import {
  deserializeSingleEntity,
  EntifixConnError,
  type EntifixError,
  type Entity,
  type EntityConstructor,
  type EntityFilter,
  type EntityFiltering,
  type EntityId,
  type EntityLoadRequest,
  type EntityPage,
  type EntitySorting,
  extractMetaAccessors,
  type FilterGroup,
  serializeEntity,
} from '@entifix/core';
import { Effect } from 'effect';

/** Escapes a string so `like`/`nlike` match literally, as the Mongo adapter does. */
const escapeRegex = (value: string): string =>
  value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const isFilterGroup = <TEntity extends Entity>(
  node: EntityFilter<TEntity> | FilterGroup<TEntity>,
): node is FilterGroup<TEntity> =>
  !('property' in node) && (node.operator === 'and' || node.operator === 'or');

const compareValues = (left: unknown, right: unknown): number => {
  if (left === right) return 0;
  // Mongo sorts missing values below present ones.
  if (left == null) return -1;
  if (right == null) return 1;
  if (typeof left === 'number' && typeof right === 'number') {
    return left - right;
  }
  if (left instanceof Date && right instanceof Date) {
    return left.getTime() - right.getTime();
  }
  return String(left).localeCompare(String(right));
};

const matchesNode = <TEntity extends Entity>(
  item: TEntity,
  node: EntityFilter<TEntity> | FilterGroup<TEntity>,
): boolean => {
  if (isFilterGroup(node)) {
    return node.operator === 'or'
      ? node.values.some(child => matchesNode(item, child))
      : node.values.every(child => matchesNode(item, child));
  }

  const actual = (item as Record<string, unknown>)[String(node.property)];

  switch (node.operator) {
    case 'eq':
      return actual === node.value;
    case 'ne':
      return actual !== node.value;
    case 'gt':
      return compareValues(actual, node.value) > 0;
    case 'gte':
      return compareValues(actual, node.value) >= 0;
    case 'lt':
      return compareValues(actual, node.value) < 0;
    case 'lte':
      return compareValues(actual, node.value) <= 0;
    case 'in':
      return node.values.includes(actual as TEntity[keyof TEntity]);
    case 'nin':
      return !node.values.includes(actual as TEntity[keyof TEntity]);
    case 'between':
      return (
        compareValues(actual, node.start) >= 0 &&
        compareValues(actual, node.end) <= 0
      );
    case 'nbetween':
      return !(
        compareValues(actual, node.start) >= 0 &&
        compareValues(actual, node.end) <= 0
      );
    case 'like':
      return new RegExp(escapeRegex(node.value), 'i').test(String(actual));
    case 'nlike':
      return !new RegExp(escapeRegex(node.value), 'i').test(String(actual));
    case 'isNull':
      return actual == null;
    case 'isNotNull':
      return actual != null;
    default: {
      // Exhaustiveness guard — a new operator must be handled explicitly.
      const never: never = node;
      return never;
    }
  }
};

const applyFiltering = <TEntity extends Entity>(
  items: TEntity[],
  filtering?: EntityFiltering<TEntity>[],
): TEntity[] => {
  if (!filtering || filtering.length === 0) return items;
  // Every top-level entry is combined with `and`, matching `translateFiltering`.
  const nodes = filtering.flatMap(entry =>
    Array.isArray(entry) ? entry : [entry],
  );
  return items.filter(item => nodes.every(node => matchesNode(item, node)));
};

const applySorting = <TEntity extends Entity>(
  items: TEntity[],
  sorting?: EntitySorting<TEntity>[],
): TEntity[] => {
  if (!sorting || sorting.length === 0) return items;

  const entries = sorting.flatMap(record =>
    Object.keys(record)
      .map(Number)
      .sort((left, right) => left - right)
      .map(priority => record[priority])
      .filter(entry => entry != null),
  );

  return [...items].sort((left, right) => {
    for (const entry of entries) {
      const property = String(entry.property);
      const result = compareValues(
        (left as Record<string, unknown>)[property],
        (right as Record<string, unknown>)[property],
      );
      if (result !== 0) return entry.type === 'desc' ? -result : result;
    }
    return 0;
  });
};

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
): Effect.Effect<TEntity, EntifixError> => {
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
  ) as Effect.Effect<TEntity, EntifixError>;
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
  failNext(error: EntifixError): void;
}

/**
 * In-memory {@link EntityRepository}: the default double for anything that
 * depends on persistence.
 *
 * Its semantics deliberately mirror `makeMongoRepository` — same filtering and
 * sorting rules, same 1-based paging with a default page size of 10, same
 * "entity not found" failure, same id minting on create — and
 * `describeEntityRepositoryContract` holds both to that shared contract.
 */
export const makeInMemoryEntityRepository = (
  seed: Entity[] = [],
): InMemoryEntityRepository => {
  let items = [...seed];
  let pendingFailure: EntifixError | undefined;

  /** Consumes a queued failure, if one was armed. */
  const guard = <TValue>(
    run: () => Effect.Effect<TValue, EntifixError>,
  ): Effect.Effect<TValue, EntifixError> => {
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
        ? Effect.fail(
            new EntifixConnError('Entity not found', undefined, { id }),
          )
        : copyOf(found as TEntity);
    });

  const save = <TEntity extends Entity>(entity: TEntity) =>
    guard(() => {
      // A create arrives without an id, so the store mints one — same rule the
      // Mongo adapter follows. The Web Crypto global rather than `node:crypto`,
      // because a browser bundle cannot resolve a `node:` import and an example
      // with no backend runs this repository in the page.
      entity.id = entity.id ?? globalThis.crypto.randomUUID();
      // The store keeps its own copy and hands back another, so neither the
      // caller's instance nor the returned one can change the record without a
      // second save — which a real adapter guarantees by construction.
      return copyOf(entity).pipe(
        Effect.tap(stored => {
          const index = items.findIndex(item => item.id === stored.id);
          if (index === -1) {
            items.push(stored);
          } else {
            items[index] = stored;
          }
        }),
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
    failNext: (error: EntifixError) => {
      pendingFailure = error;
    },
    // Each method closes over its own state, so nothing is required from the
    // Effect environment; that is assignable to the interface's channel.
  } as unknown as InMemoryEntityRepository;
};
