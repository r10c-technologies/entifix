import type { EntityFieldDescriptor } from '@entifix/core';
import { describe, expect, it } from 'vitest';

import { nextHeaderSorting, type SortKey, sortKeys } from './header-sort.js';

const descriptor = (name: string): EntityFieldDescriptor =>
  ({ name, key: name, type: 'string' }) as EntityFieldDescriptor;
const columns = [descriptor('name'), descriptor('code')];

const key = (member: string, type: 'asc' | 'desc'): SortKey => ({
  member,
  property: member,
  type,
});
const name = { member: 'name', property: 'name' };

describe('sortKeys', () => {
  it('reads the keys in precedence order, dropping one no column sorts by', () => {
    expect(
      sortKeys(
        {
          2: { property: 'code', type: 'desc' },
          0: { property: 'name', type: 'asc' },
          1: { property: 'gone', type: 'asc' },
        } as never,
        columns,
      ),
    ).toEqual([key('name', 'asc'), key('code', 'desc')]);
    expect(sortKeys(undefined, columns)).toEqual([]);
  });
});

describe('nextHeaderSorting', () => {
  it('cycles a plain click through ascending, descending and unsorted', () => {
    expect(nextHeaderSorting([], name, false)).toEqual({
      0: { property: 'name', type: 'asc' },
    });
    expect(nextHeaderSorting([key('name', 'asc')], name, false)).toEqual({
      0: { property: 'name', type: 'desc' },
    });
    expect(nextHeaderSorting([key('name', 'desc')], name, false)).toEqual({});
  });

  it('makes a plain click the only key, starting a secondary one over', () => {
    expect(
      nextHeaderSorting(
        [key('code', 'desc'), key('name', 'desc')],
        name,
        false,
      ),
    ).toEqual({ 0: { property: 'name', type: 'asc' } });
  });

  it('adds a Shift-click as the next key, or cycles it where it stands', () => {
    expect(nextHeaderSorting([key('code', 'desc')], name, true)).toEqual({
      0: { property: 'code', type: 'desc' },
      1: { property: 'name', type: 'asc' },
    });
    expect(
      nextHeaderSorting([key('name', 'asc'), key('code', 'desc')], name, true),
    ).toEqual({
      0: { property: 'name', type: 'desc' },
      1: { property: 'code', type: 'desc' },
    });
    expect(
      nextHeaderSorting([key('name', 'desc'), key('code', 'desc')], name, true),
    ).toEqual({ 0: { property: 'code', type: 'desc' } });
  });
});
