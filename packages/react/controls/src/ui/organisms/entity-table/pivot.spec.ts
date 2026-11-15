import { describe, expect, it } from 'vitest';

import { cardRoles } from './card-roles.js';
import type { EntityTableColumn } from './entity-table.types.js';
import { columnWidth, pivotClasses, pivotWidths } from './pivot.js';

const column = (
  name: string,
  type: string,
  extra: { minWidth?: number; card?: string } = {},
) => ({ name, type, ...extra }) as unknown as EntityTableColumn<never>;

describe('columnWidth', () => {
  it('reads a declared width, its type’s, or the default', () => {
    expect(columnWidth(column('a', 'string', { minWidth: 14 }))).toBe(14);
    expect(columnWidth(column('b', 'number'))).toBe(6);
    expect(columnWidth(column('c', 'json'))).toBe(8);
  });
});

describe('pivotWidths', () => {
  // A shipment's eleven columns: an id, a title, a status, eight more.
  const title = column('name', 'string', { minWidth: 16 });
  const columns = [
    column('id', 'id'),
    title,
    column('status', 'enum'),
    ...Array.from({ length: 8 }, (_, index) =>
      column(`m${index}`, 'string', { minWidth: 9 }),
    ),
  ];
  const widths = (breakpoint?: 'lg') =>
    pivotWidths({
      columns,
      title,
      roleOf: cardRoles(columns),
      extra: 3 + 5,
      breakpoint,
    });

  it('counts the title, the badges, two meta columns and the extras as essential', () => {
    // 16 + 8 (status) + 9 + 9 + 3 + 5
    expect(widths().essential).toBe(50);
  });

  it('counts every column as the full width', () => {
    expect(widths().full).toBe(6 + 16 + 8 + 8 * 9 + 8);
  });

  it('ignores a column declared hidden on the card, and works without a title', () => {
    const hidden = [
      column('note', 'string', { card: 'hidden', minWidth: 40 }),
      column('code', 'string', { card: 'subtitle' }),
    ];
    expect(
      pivotWidths({
        columns: hidden,
        title: undefined,
        roleOf: cardRoles(hidden),
        extra: 0,
      }).essential,
    ).toBe(10);
  });

  it('takes a declared breakpoint over both', () => {
    expect(widths('lg')).toEqual({ essential: 64, full: 64 });
  });
});

describe('pivotClasses', () => {
  it('takes the first named container size that holds the width, or the widest', () => {
    expect(pivotClasses(33).grid).toBe('hidden @xl/entity-table:block');
    expect(pivotClasses(4).cards).toBe('@xs/entity-table:hidden');
    expect(pivotClasses(500).grid).toBe('hidden @7xl/entity-table:block');
  });
});
