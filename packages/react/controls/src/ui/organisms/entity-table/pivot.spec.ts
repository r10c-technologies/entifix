import { describe, expect, it } from 'vitest';

import type { EntityTableColumn } from './entity-table.types.js';
import { pivotClasses, pivotWidth } from './pivot.js';

const column = (type: string, minWidth?: number) =>
  ({ name: type, type, minWidth }) as unknown as EntityTableColumn<never>;

describe('pivotWidth', () => {
  it('sums each column’s declared width, its type’s, or the default', () => {
    expect(
      pivotWidth([column('string', 14), column('number'), column('json')], 3),
    ).toBe(14 + 6 + 8 + 3);
  });

  it('takes a declared breakpoint over the columns', () => {
    expect(pivotWidth([column('string')], 0, 'lg')).toBe(64);
  });
});

describe('pivotClasses', () => {
  it('takes the first named container size that holds the width, or the widest', () => {
    expect(pivotClasses(33).grid).toBe('hidden @xl/entity-table:block');
    expect(pivotClasses(4).cards).toBe('@xs/entity-table:hidden');
    expect(pivotClasses(500).grid).toBe('hidden @7xl/entity-table:block');
  });
});
