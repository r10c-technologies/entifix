import { describe, expect, it } from 'vitest';

import { EntityCollectionLink } from '../entity-definition/links/entity-collection-link/index.js';
import { EntityLink } from '../entity-definition/links/entity-link/index.js';
import type { Entity, EntityId } from '../types/Entity.js';
import type { EntityFiltering } from '../types/EntityFiltering.js';
import {
  applyFiltering,
  applySorting,
  compareStoredValues,
  matchesFiltering,
  storedValue,
  valueAt,
} from './in-memory-query.js';

class Brand implements Entity {
  id: EntityId;
}

interface Row extends Entity {
  id: string;
  name?: string | null;
  size?: number;
  at?: Date;
  tags?: readonly string[];
  title?: Readonly<Record<string, string>>;
  brand?: EntityLink<Brand>;
  brands?: EntityCollectionLink<Brand>;
}

const rows: Row[] = [
  {
    id: 'a',
    name: 'Alpha',
    size: 10,
    at: new Date('2026-01-01'),
    tags: ['blue', 'green'],
    title: { en: 'Apple', es: 'Manzana' },
    brand: new EntityLink(Brand, { id: 'b-1' }),
    brands: new EntityCollectionLink(Brand, { ids: ['b-1', 'b-2'] }),
  },
  {
    id: 'b',
    name: 'Beta',
    size: 20,
    at: new Date('2026-02-01'),
    tags: ['green'],
    title: { en: 'Banana', es: 'Plátano' },
    brand: new EntityLink(Brand, { id: 'b-2' }),
  },
  { id: 'c', name: null, size: 30 },
];

const ids = (filtering: EntityFiltering<Row>[]) =>
  applyFiltering(rows, filtering).map(row => row.id);

describe('storedValue', () => {
  it('reads a link as its id and a collection link as its ids', () => {
    expect(storedValue(rows[0]!.brand)).toBe('b-1');
    expect(storedValue(rows[0]!.brands)).toEqual(['b-1', 'b-2']);
    expect(storedValue('x')).toBe('x');
  });
});

describe('valueAt', () => {
  it('follows a dotted path into an object, and stops at anything else', () => {
    expect(valueAt(rows[0]!, 'title.es')).toBe('Manzana');
    expect(valueAt(rows[0]!, 'name.length')).toBeUndefined();
    expect(valueAt(rows[2]!, 'title.en')).toBeUndefined();
  });
});

describe('compareStoredValues', () => {
  it('sorts a missing value below a present one', () => {
    expect(compareStoredValues(undefined, null)).toBe(0);
    expect(compareStoredValues(null, 1)).toBeLessThan(0);
    expect(compareStoredValues(1, undefined)).toBeGreaterThan(0);
  });

  it('compares numbers, dates and text as themselves', () => {
    expect(compareStoredValues(2, 10)).toBeLessThan(0);
    expect(
      compareStoredValues(new Date('2026-02-01'), new Date('2026-01-01')),
    ).toBeGreaterThan(0);
    expect(compareStoredValues('b', 'a')).toBeGreaterThan(0);
    expect(compareStoredValues('a', 'a')).toBe(0);
  });
});

describe('applyFiltering', () => {
  it('keeps everything without filtering', () => {
    expect(applyFiltering(rows, undefined)).toHaveLength(3);
    expect(matchesFiltering(rows[0]!, [])).toBe(true);
  });

  it('compares by equality, dates by their instant', () => {
    expect(ids([{ property: 'name', operator: 'eq', value: 'Beta' }])).toEqual([
      'b',
    ]);
    expect(ids([{ property: 'name', operator: 'ne', value: 'Beta' }])).toEqual([
      'a',
      'c',
    ]);
    expect(
      ids([{ property: 'at', operator: 'eq', value: new Date('2026-01-01') }]),
    ).toEqual(['a']);
  });

  it('compares order, never matching a missing value', () => {
    expect(ids([{ property: 'size', operator: 'gt', value: 10 }])).toEqual([
      'b',
      'c',
    ]);
    expect(ids([{ property: 'size', operator: 'gte', value: 20 }])).toEqual([
      'b',
      'c',
    ]);
    expect(ids([{ property: 'size', operator: 'lt', value: 20 }])).toEqual([
      'a',
    ]);
    expect(ids([{ property: 'size', operator: 'lte', value: 20 }])).toEqual([
      'a',
      'b',
    ]);
    expect(
      ids([{ property: 'at', operator: 'lt', value: new Date('2027-01-01') }]),
    ).toEqual(['a', 'b']);
  });

  it('matches a range inclusively, and its negation', () => {
    expect(
      ids([{ property: 'size', operator: 'between', start: 15, end: 30 }]),
    ).toEqual(['b', 'c']);
    expect(
      ids([{ property: 'size', operator: 'nbetween', start: 15, end: 30 }]),
    ).toEqual(['a']);
    expect(
      ids([{ property: 'at', operator: 'between', start: 0, end: 1 }]),
    ).toEqual([]);
  });

  it('matches `in` against any element of an array, as `$in` does', () => {
    expect(
      ids([{ property: 'tags', operator: 'in', values: ['blue', 'red'] }]),
    ).toEqual(['a']);
    expect(
      ids([{ property: 'tags', operator: 'nin', values: ['blue', 'red'] }]),
    ).toEqual(['b', 'c']);
    expect(
      ids([{ property: 'name', operator: 'in', values: ['Alpha', 'Beta'] }]),
    ).toEqual(['a', 'b']);
  });

  it('matches links and collection links by id', () => {
    expect(
      ids([{ property: 'brand', operator: 'eq', value: 'b-2' as never }]),
    ).toEqual(['b']);
    expect(
      ids([{ property: 'brands', operator: 'in', values: ['b-2' as never] }]),
    ).toEqual(['a']);
  });

  it('matches `like` as a case-insensitive literal substring, never on a missing value', () => {
    expect(ids([{ property: 'name', operator: 'like', value: 'ET' }])).toEqual([
      'b',
    ]);
    expect(ids([{ property: 'name', operator: 'like', value: 'a.p' }])).toEqual(
      [],
    );
    expect(ids([{ property: 'name', operator: 'like', value: 'ul' }])).toEqual(
      [],
    );
    expect(ids([{ property: 'name', operator: 'nlike', value: 'et' }])).toEqual(
      ['a', 'c'],
    );
  });

  it('reaches one locale of an object member through a dotted path', () => {
    expect(
      ids([{ property: 'title.es' as never, operator: 'like', value: 'plá' }]),
    ).toEqual(['b']);
  });

  it('matches absence', () => {
    expect(ids([{ property: 'name', operator: 'isNull' }])).toEqual(['c']);
    expect(ids([{ property: 'name', operator: 'isNotNull' }])).toEqual([
      'a',
      'b',
    ]);
  });

  it('combines entries and nested lists with `and`, and groups by their operator', () => {
    expect(
      ids([
        { property: 'size', operator: 'gte', value: 20 },
        [{ property: 'name', operator: 'isNotNull' }],
      ]),
    ).toEqual(['b']);
    expect(
      ids([
        {
          operator: 'or',
          values: [
            { property: 'name', operator: 'eq', value: 'Alpha' },
            {
              operator: 'and',
              values: [
                { property: 'size', operator: 'gt', value: 25 },
                { property: 'name', operator: 'isNull' },
              ],
            },
          ],
        },
      ]),
    ).toEqual(['a', 'c']);
  });

  it('rejects an operator it does not know rather than guessing', () => {
    expect(() =>
      ids([{ property: 'name', operator: 'near' as never, value: 'x' }]),
    ).toThrow(/Unknown filter operator "near"/);
  });
});

describe('applySorting', () => {
  it('leaves the given order without keys, as a new array', () => {
    const sorted = applySorting(rows, undefined);
    expect(sorted).toEqual(rows);
    expect(sorted).not.toBe(rows);
    expect(applySorting(rows, [{}]).map(row => row.id)).toEqual([
      'a',
      'b',
      'c',
    ]);
  });

  it('sorts by priority, missing values first, either direction', () => {
    expect(
      applySorting(rows, [{ 0: { property: 'name', type: 'asc' } }]).map(
        row => row.id,
      ),
    ).toEqual(['c', 'a', 'b']);
    expect(
      applySorting(rows, [{ 0: { property: 'size', type: 'desc' } }]).map(
        row => row.id,
      ),
    ).toEqual(['c', 'b', 'a']);
  });

  it('breaks a tie on the next key, and sorts one locale of an object member', () => {
    const tied: Row[] = [
      { id: 'x', size: 1, title: { en: 'b' } },
      { id: 'y', size: 1, title: { en: 'a' } },
    ];
    expect(
      applySorting(tied, [
        {
          1: { property: 'title.en' as never, type: 'asc' },
          0: { property: 'size', type: 'asc' },
        },
      ]).map(row => row.id),
    ).toEqual(['y', 'x']);
    expect(
      applySorting(tied, [{ 0: { property: 'size', type: 'asc' } }]).map(
        row => row.id,
      ),
    ).toEqual(['x', 'y']);
  });
});

describe('applyFiltering on a path into an array', () => {
  interface Line {
    readonly vendor: string;
    readonly qty: number;
    readonly note?: string | null;
  }
  interface Order extends Entity {
    id: string;
    lines?: readonly Line[];
    label?: string;
  }

  const orders: Order[] = [
    {
      id: 'mixed',
      lines: [
        { vendor: 'acme', qty: 1, note: 'gift' },
        { vendor: 'globex', qty: 5 },
      ],
    },
    { id: 'acme-only', lines: [{ vendor: 'acme', qty: 3, note: null }] },
    { id: 'empty', lines: [] },
    { id: 'none' },
  ];
  const matching = (filtering: EntityFiltering<Order>[]) =>
    applyFiltering(orders, filtering).map(order => order.id);

  it('keeps a record when any element satisfies the filter', () => {
    expect(
      matching([{ property: 'lines.vendor', operator: 'eq', value: 'acme' }]),
    ).toEqual(['mixed', 'acme-only']);
    expect(
      matching([{ property: 'lines.qty', operator: 'gt', value: 4 }]),
    ).toEqual(['mixed']);
    expect(
      matching([{ property: 'lines.qty', operator: 'gte', value: 3 }]),
    ).toEqual(['mixed', 'acme-only']);
    expect(
      matching([{ property: 'lines.qty', operator: 'lt', value: 2 }]),
    ).toEqual(['mixed']);
    expect(
      matching([{ property: 'lines.qty', operator: 'lte', value: 3 }]),
    ).toEqual(['mixed', 'acme-only']);
    expect(
      matching([
        { property: 'lines.vendor', operator: 'in', values: ['globex'] },
      ]),
    ).toEqual(['mixed']);
    expect(
      matching([
        { property: 'lines.qty', operator: 'between', start: 2, end: 4 },
      ]),
    ).toEqual(['acme-only']);
    expect(
      matching([{ property: 'lines.vendor', operator: 'like', value: 'glo' }]),
    ).toEqual(['mixed']);
    expect(
      matching([{ property: 'lines.note', operator: 'isNotNull' }]),
    ).toEqual(['mixed']);
  });

  it('keeps a record for a negated filter only when no element satisfies its positive form', () => {
    expect(
      matching([{ property: 'lines.vendor', operator: 'ne', value: 'acme' }]),
    ).toEqual(['empty', 'none']);
    expect(
      matching([
        { property: 'lines.vendor', operator: 'nin', values: ['globex'] },
      ]),
    ).toEqual(['acme-only', 'empty', 'none']);
    expect(
      matching([
        { property: 'lines.qty', operator: 'nbetween', start: 2, end: 4 },
      ]),
    ).toEqual(['mixed', 'empty', 'none']);
    expect(
      matching([{ property: 'lines.vendor', operator: 'nlike', value: 'ac' }]),
    ).toEqual(['empty', 'none']);
    expect(matching([{ property: 'lines.note', operator: 'isNull' }])).toEqual([
      'acme-only',
      'empty',
      'none',
    ]);
  });

  it('reads an element that is not a record as holding nothing', () => {
    const odd = [
      { id: 'odd', lines: ['not a line'] as unknown as Line[] },
    ] as Order[];

    expect(
      applyFiltering(odd, [
        { property: 'lines.vendor', operator: 'isNull' },
      ]).map(order => order.id),
    ).toEqual(['odd']);
  });

  it('refuses a path that names no member, at compile time', () => {
    const typed: EntityFiltering<Order> = {
      property: 'lines.vendor',
      operator: 'eq',
      value: 'acme',
    };
    // @ts-expect-error — `lines.price` is not a member of a line.
    const unknownMember: EntityFiltering<Order> = {
      property: 'lines.price',
      operator: 'eq',
      value: 1,
    };
    // @ts-expect-error — a path's value is typed from the element's member.
    const wrongValue: EntityFiltering<Order> = {
      property: 'lines.qty',
      operator: 'eq',
      value: 'three',
    };

    expect([typed, unknownMember, wrongValue]).toHaveLength(3);
  });
});
