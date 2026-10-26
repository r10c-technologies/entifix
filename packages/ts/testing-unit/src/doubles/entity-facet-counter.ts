import type { EntityFacetCounter } from '@entifix/business';
import {
  countFacets,
  type EntifixError,
  type Entity,
  type EntityFacetQuery,
} from '@entifix/core';
import { Effect } from 'effect';

export interface InMemoryEntityFacetCounter extends EntityFacetCounter {
  /**
   * Makes the next count fail with `error`, so a caller's degraded path is
   * reachable without reaching for a mocking library.
   */
  failNext(error: EntifixError): void;
}

/**
 * An {@link EntityFacetCounter} over records held in memory, counted by the
 * same rules as every other in-memory query.
 *
 * `source` is either the records themselves or anything holding them — an
 * `InMemoryEntityRepository` — read on every count, so a spec that saves
 * through the repository sees the counts move.
 */
export const makeInMemoryFacetCounter = (
  source: readonly Entity[] | { readonly items: readonly Entity[] },
): InMemoryEntityFacetCounter => {
  let pendingFailure: EntifixError | undefined;
  const records = () => ('items' in source ? source.items : source);

  return {
    count: <TEntity extends Entity>(
      queries: readonly EntityFacetQuery<TEntity>[],
    ) =>
      Effect.suspend(() => {
        if (pendingFailure !== undefined) {
          const error = pendingFailure;
          pendingFailure = undefined;
          return Effect.fail(error);
        }
        return Effect.succeed(
          countFacets(records() as readonly TEntity[], queries),
        );
      }),
    failNext: error => {
      pendingFailure = error;
    },
  };
};
