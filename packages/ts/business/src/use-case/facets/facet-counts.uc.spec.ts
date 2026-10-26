import type { Entity, EntityFacetQuery, EntityId } from '@entifix/core';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { EntityFacetCounterTag } from '../../repository/entity-facet-counter.js';
import { facetCountsUCFactory } from './facet-counts.uc.js';

interface Widget extends Entity {
  readonly id: EntityId;
  readonly brand: string;
}

describe('facetCountsUCFactory', () => {
  it('asks the counter it is given, with the queries it was handed', async () => {
    const asked: unknown[] = [];
    const queries: EntityFacetQuery<Widget>[] = [
      {
        member: 'brand',
        filtering: [{ property: 'brand', operator: 'ne', value: 'x' }],
      },
    ];

    const counts = await Effect.runPromise(
      facetCountsUCFactory(queries).pipe(
        Effect.provideService(EntityFacetCounterTag, {
          count: received => {
            asked.push(received);
            return Effect.succeed({ brand: [{ value: 'a', count: 1 }] });
          },
        }),
      ),
    );

    expect(asked).toEqual([queries]);
    expect(counts).toEqual({ brand: [{ value: 'a', count: 1 }] });
  });
});
