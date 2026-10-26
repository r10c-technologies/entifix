import type { Entity, EntityFacetQuery } from '@entifix/core';
import { Effect } from 'effect';

import { EntityFacetCounterTag } from '../../repository/entity-facet-counter.js';

/**
 * The counts for `queries`, from whichever counter the caller provides.
 *
 * The queries are an argument rather than a tag: a tag cannot carry the
 * entity's type, and the cast a load request needs to cross one is exactly
 * what this use case has no reason to inherit.
 */
export const facetCountsUCFactory = <TEntity extends Entity>(
  queries: readonly EntityFacetQuery<TEntity>[],
) =>
  Effect.gen(function* () {
    const counter = yield* EntityFacetCounterTag;
    return yield* counter.count<TEntity>(queries);
  });
