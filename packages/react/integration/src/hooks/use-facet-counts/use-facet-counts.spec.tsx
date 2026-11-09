import { EntityFacetCounterTag } from '@entifix/business';
import type { EntityFacetQuery, FilterGroup } from '@entifix/core';
import { renderHook, waitFor } from '@testing-library/react';
import { Context, Effect } from 'effect';
import type { ReactNode } from 'react';
import { describe, expect, it } from 'vitest';

import { EntifixQueryProvider } from '../../query/query-provider.js';
import { useFacetCounts } from './use-facet-counts.js';

const wrapper = ({ children }: { children: ReactNode }) => (
  <EntifixQueryProvider>{children}</EntifixQueryProvider>
);

/** A counter that records what it was asked and answers one count. */
function counter() {
  const asked: EntityFacetQuery[][] = [];
  const ctx = Context.make(EntityFacetCounterTag, {
    count: queries => {
      asked.push([...queries] as unknown as EntityFacetQuery[]);
      return Effect.succeed({ state: [{ value: 'draft', count: 3 }] });
    },
  });
  return { asked, ctx };
}

const state = { name: 'state', key: 'state' };

describe('useFacetCounts', () => {
  it('counts each member under the filtering, less its own clauses', async () => {
    const { asked, ctx } = counter();
    const filtering = {
      operator: 'and',
      values: [
        { property: 'state', operator: 'eq', value: 'draft' },
        { property: 'name', operator: 'like', value: 'A' },
        { operator: 'or', values: [] },
      ],
    } as unknown as FilterGroup<never>;

    const { result } = renderHook(
      () =>
        useFacetCounts({ ctx, members: [state], filtering, scope: ['gizmo'] }),
      { wrapper },
    );

    await waitFor(() =>
      expect(result.current).toEqual({
        state: [{ value: 'draft', count: 3 }],
      }),
    );
    expect(asked[0]).toEqual([
      {
        member: 'state',
        filtering: [
          {
            operator: 'and',
            values: [
              { property: 'name', operator: 'like', value: 'A' },
              { operator: 'or', values: [] },
            ],
          },
        ],
      },
    ]);
  });

  it('counts an `or` group as it stands, and no filtering as none', async () => {
    const { asked, ctx } = counter();
    const either = {
      operator: 'or',
      values: [{ property: 'state', operator: 'eq', value: 'draft' }],
    } as unknown as FilterGroup<never>;

    renderHook(
      () =>
        useFacetCounts({
          ctx,
          members: [state],
          filtering: either,
          scope: ['a'],
        }),
      { wrapper },
    );
    renderHook(
      () =>
        useFacetCounts({
          ctx,
          members: [state],
          filtering: undefined,
          scope: ['b'],
        }),
      { wrapper },
    );

    await waitFor(() => expect(asked).toHaveLength(2));
    expect(asked).toContainEqual([{ member: 'state', filtering: [either] }]);
    expect(asked).toContainEqual([{ member: 'state' }]);
  });

  it('counts nothing without a counter or a member', () => {
    const { result } = renderHook(
      () =>
        useFacetCounts({
          ctx: undefined,
          members: [state],
          filtering: undefined,
          scope: ['c'],
        }),
      { wrapper },
    );

    expect(result.current).toBeUndefined();
  });
});
