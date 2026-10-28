import type { EntityFacetCounter, EntityRepository } from '@entifix/business';
import {
  applyFiltering,
  applySorting,
  countFacets,
  Declined,
  deserializeSingleEntity,
  type Entity,
  type EntityConstructor,
  type EntityFacetQuery,
  type EntityId,
  type EntityLoadRequest,
  type EntityPage,
  extractMetaAccessors,
  NotFound,
  serializeEntity,
  type TransitionalFailure,
} from '@entifix/core';
import { Effect } from 'effect';

/** The Mongo adapter's defaults, which this one copies exactly. */
const DEFAULT_PAGE = 1;
const DEFAULT_PAGE_SIZE = 10;

/**
 * A copy of a record, so a caller can never reach into the store.
 *
 * Through the entity's own mapping — serialize, then deserialize — as a real
 * adapter maps every record on the way out. An entity with no accessors has no
 * mapping to go through, so it is copied member by member instead.
 */
function copyOf<TEntity extends Entity>(
  record: TEntity,
): Effect.Effect<TEntity, TransitionalFailure> {
  const entityConstructor = record.constructor as EntityConstructor<TEntity>;
  if (extractMetaAccessors(entityConstructor).length === 0) {
    return Effect.succeed(
      Object.assign(
        Object.create(Object.getPrototypeOf(record) as object) as TEntity,
        record,
      ),
    );
  }
  // `undefined` only comes back for `null`/`undefined` input, and
  // `serializeEntity` always hands over an object.
  return deserializeSingleEntity(
    entityConstructor,
    serializeEntity(entityConstructor, record),
  ) as Effect.Effect<TEntity, TransitionalFailure>;
}

export interface StaticRepositoryOptions {
  /** The name an error message uses. Defaults to the entity's class name. */
  readonly label?: string;
}

/**
 * A read-only {@link EntityRepository} over records held in memory — content
 * bundled with a static build, served through the ordinary use cases, and
 * swappable for a REST adapter the day a backend appears.
 *
 * `get` and `load` carry the Mongo adapter's semantics, from core's in-memory
 * query evaluation: every filter operator, groups, array membership, a dotted
 * path into a localized member, multi-key sorting, and 1-based paging that
 * defaults to ten. Both hand out copies.
 *
 * `save` and `delete` fail with `Declined`: a static source is
 * read-only, and pretending otherwise is worse than refusing.
 *
 * It holds instances. Records that arrive as JSON go through
 * {@link staticRepositoryFromRecords}, which validates them first.
 */
export function makeStaticRepository<TEntity extends Entity>(
  entityConstructor: EntityConstructor<TEntity>,
  records: readonly TEntity[],
  { label = entityConstructor.name }: StaticRepositoryOptions = {},
): EntityRepository {
  const stored = [...records];

  const readOnly = (verb: string) =>
    Effect.fail(
      new Declined({
        reason: `Cannot ${verb} a ${label}: it is served from static content, which is read-only`,
      }),
    );

  const get = (id: EntityId) => {
    const found = stored.find(record => record.id === id);
    return found === undefined
      ? Effect.fail(new NotFound({ entity: label }))
      : copyOf(found);
  };

  const load = (request: EntityLoadRequest<TEntity>) =>
    Effect.suspend(() => {
      const matched = applySorting(
        applyFiltering(stored, request.filtering),
        request.sorting,
      );
      const page = request.page ?? DEFAULT_PAGE;
      const pageSize = request.pageSize ?? DEFAULT_PAGE_SIZE;
      const start = (page - 1) * pageSize;

      return Effect.forEach(
        matched.slice(start, start + pageSize),
        copyOf,
      ).pipe(
        Effect.map(
          items =>
            ({
              items,
              total: matched.length,
              request,
            }) satisfies EntityPage<TEntity>,
        ),
      );
    });

  // Each method closes over its own state, so nothing is required from the
  // Effect environment; that is assignable to the port's channel, and the
  // cast keeps its generic signatures, as entifix's other adapters do.
  return {
    get,
    load,
    save: () => readOnly('save'),
    delete: () => readOnly('delete'),
  } as unknown as EntityRepository;
}

/**
 * Facet counts over the same records a {@link makeStaticRepository} serves:
 * how many hold each value of a member, each member under its own filtering,
 * with the in-memory query's rules.
 */
export function makeStaticFacetCounter<TEntity extends Entity>(
  records: readonly TEntity[],
): EntityFacetCounter {
  const stored = [...records];
  return {
    count: (queries: readonly EntityFacetQuery<TEntity>[]) =>
      Effect.sync(() => countFacets(stored, queries)),
  } as unknown as EntityFacetCounter;
}
