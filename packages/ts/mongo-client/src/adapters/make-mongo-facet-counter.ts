import type { EntityFacetCounter } from '@entifix/business';
import {
  compareStoredValues,
  EntifixConnError,
  type Entity,
  type EntityConstructor,
  type EntityFacetCounts,
  type EntityFacetQuery,
  type EntityFacetValue,
} from '@entifix/core';
import { Effect } from 'effect';
import type { ClientSession, Db, Document } from 'mongodb';

import { translateFiltering } from './filter-translator.js';
import { mongoCollectionName } from './make-mongo-repository.js';

const isFacetValue = (value: unknown): value is EntityFacetValue['value'] =>
  typeof value === 'string' ||
  typeof value === 'number' ||
  typeof value === 'boolean';

/** Count first, highest first; a tie by value — the order core's counter keeps. */
const byCountThenValue = (left: EntityFacetValue, right: EntityFacetValue) =>
  right.count - left.count || compareStoredValues(left.value, right.value);

/**
 * One `$facet` branch: the member's own filtering, then one row per value.
 *
 * `$unwind` is in every branch, not only an array member's: on a scalar it
 * passes the document through, and on a missing or `null` value it drops it —
 * which is the "a missing value is not counted" rule, for free.
 */
const branchFor = <TEntity extends Entity>({
  member,
  filtering,
}: EntityFacetQuery<TEntity>): Document[] => [
  { $match: translateFiltering(filtering) },
  { $unwind: `$${member}` },
  { $group: { _id: `$${member}`, count: { $sum: 1 } } },
];

/**
 * Builds an {@link EntityFacetCounter} for one entity over a live mongodb
 * {@link Db}: every facet in **one** aggregation, a `$facet` whose branches
 * each `$match` their own filtering, so a disjunctive panel costs one round
 * trip however many facets it shows.
 *
 * Filtering goes through the same translator the repository's `load` uses, so a
 * count and the page beside it can never disagree about what a filter means.
 * A value that is not a string, number or boolean is dropped, as in core's
 * in-memory counter.
 */
export function makeMongoFacetCounter<TEntity extends Entity>(
  db: Db,
  entityConstructor: EntityConstructor<TEntity>,
  options?: { readonly session?: ClientSession },
): EntityFacetCounter {
  const collection = db.collection(mongoCollectionName(entityConstructor));
  const inSession = options?.session ? { session: options.session } : {};

  const count = <T extends Entity>(queries: readonly EntityFacetQuery<T>[]) =>
    Effect.gen(function* () {
      // A `$facet` with no branch is a server error; asking for nothing is
      // not.
      if (queries.length === 0) return {} satisfies EntityFacetCounts;

      const [result] = yield* Effect.tryPromise({
        try: () =>
          collection
            .aggregate(
              [
                {
                  $facet: Object.fromEntries(
                    queries.map(query => [query.member, branchFor(query)]),
                  ),
                },
              ],
              inSession,
            )
            .toArray(),
        catch: error =>
          new EntifixConnError('Failed to count facets in MongoDB', error, {
            entity: entityConstructor.name,
          }),
      });

      const counts: Record<string, readonly EntityFacetValue[]> = {};
      for (const { member } of queries) {
        const rows = ((result as Document | undefined)?.[member] ??
          []) as Document[];
        counts[member] = rows
          .filter(row => isFacetValue(row['_id']))
          .map(row => ({
            value: row['_id'] as EntityFacetValue['value'],
            count: row['count'] as number,
          }))
          .sort(byCountThenValue);
      }
      return counts satisfies EntityFacetCounts;
    });

  return { count };
}
