import {
  accessor,
  describeEntityColumns,
  type Entity,
  entity,
  type EntityId,
} from '@entifix/core';

import type { EntityTableColumn } from './entity-table.types.js';
import {
  EntityColumn,
  EntityTableHeader,
  EntityTableRow,
  EntityTableToolbar,
  readEntityTableSlots,
} from './entity-table-slots.js';
import { resolveEntityTableColumns } from './use-entity-table-columns.js';

@entity({ key: 'gadget' })
class Gadget implements Entity {
  #id?: EntityId;
  #code?: string;
  #name?: string;

  @accessor({ type: 'id' })
  get id(): EntityId {
    return this.#id;
  }
  set id(value: EntityId) {
    this.#id = value;
  }

  @accessor({ type: 'string', label: 'Code' })
  get code(): string | undefined {
    return this.#code;
  }
  set code(value: string | undefined) {
    this.#code = value;
  }

  @accessor({ type: 'string', label: 'Name' })
  get name(): string | undefined {
    return this.#name;
  }
  set name(value: string | undefined) {
    this.#name = value;
  }
}

const described = () =>
  describeEntityColumns(Gadget) as Array<EntityTableColumn<Gadget>>;
const names = (columns: Array<EntityTableColumn<Gadget>>) =>
  columns.map(column => column.name);

describe('resolveEntityTableColumns', () => {
  it('defaults to the metadata columns in declaration order', () => {
    const { columns, visibleColumns } = resolveEntityTableColumns<Gadget>(
      described(),
      [],
      {},
    );
    expect(names(columns)).toEqual(['code', 'name']);
    expect(names(visibleColumns)).toEqual(['code', 'name']);
  });

  // The record's own key is how it is addressed, never how a person reads it:
  // a list leaves it out unless the host asks for it.
  it("leaves out the record's own key unless the host shows it", () => {
    const shown = resolveEntityTableColumns<Gadget>(
      described(),
      [],
      {},
      [],
      true,
    );
    expect(names(shown.columns)).toEqual(['id', 'code', 'name']);
  });

  it('keeps a key that references another record', () => {
    const withReference = [
      ...described(),
      {
        ...described()[0],
        name: 'ownerId',
        key: 'ownerId',
        references: { entity: 'sales:owner' },
      },
    ] as Array<EntityTableColumn<Gadget>>;
    const { columns } = resolveEntityTableColumns<Gadget>(
      withReference,
      [],
      {},
    );
    expect(names(columns)).toContain('ownerId');
    expect(names(columns)).not.toContain('id');
  });

  it('applies a slot override without changing the column set', () => {
    const { columns } = resolveEntityTableColumns<Gadget>(
      described(),
      [{ field: 'code', label: 'SKU' }],
      {},
    );
    expect(names(columns)).toEqual(['code', 'name']);
    expect(columns.find(column => column.name === 'code')?.label).toBe('SKU');
  });

  it('appends a slot column the entity has no member for', () => {
    const { columns } = resolveEntityTableColumns<Gadget>(
      described(),
      [{ field: 'margin', label: 'Margin', type: 'number' }],
      {},
    );
    const margin = columns.find(column => column.name === 'margin');
    expect(margin).toMatchObject({
      label: 'Margin',
      type: 'number',
      virtual: true,
    });
  });

  it("carries a slot column's declared width, so the pivot counts it", () => {
    const { columns } = resolveEntityTableColumns<Gadget>(
      described(),
      [{ field: 'price', label: 'Price', type: 'number', minWidth: 11 }],
      {},
    );
    expect(columns.find(column => column.name === 'price')?.minWidth).toBe(11);
  });

  it("carries a slot column's money format, so its cell prints an amount", () => {
    const money = { unit: 'minor', currency: 'GTQ' } as const;
    const { columns } = resolveEntityTableColumns<Gadget>(
      described(),
      [{ field: 'price', type: 'number', money }],
      {},
    );
    expect(columns.find(column => column.name === 'price')?.money).toEqual(
      money,
    );
    const { columns: plain } = resolveEntityTableColumns<Gadget>(
      described(),
      [{ field: 'price', type: 'number' }],
      {},
    );
    expect(plain.find(column => column.name === 'price')).not.toHaveProperty(
      'money',
    );
  });

  it('reorders per the stored personalization', () => {
    const { columns } = resolveEntityTableColumns<Gadget>(described(), [], {
      order: ['name', 'code'],
    });
    expect(names(columns)).toEqual(['name', 'code']);
  });

  it('keeps columns missing from a stored order, at the end', () => {
    // A member added to the entity after the layout was saved must still show.
    const { columns } = resolveEntityTableColumns<Gadget>(described(), [], {
      order: ['name'],
    });
    expect(names(columns)).toEqual(['name', 'code']);
  });

  it('ignores stale names in a stored order', () => {
    const { columns } = resolveEntityTableColumns<Gadget>(described(), [], {
      order: ['removed', 'name'],
    });
    expect(names(columns)).toEqual(['name', 'code']);
  });

  it('drops hidden columns from the visible set only', () => {
    const { columns, visibleColumns, hidden } =
      resolveEntityTableColumns<Gadget>(described(), [], { hidden: ['code'] });
    expect(names(columns)).toContain('code');
    expect(names(visibleColumns)).toEqual(['name']);
    expect(hidden).toEqual(['code']);
  });

  // A withheld column is not a hidden one: it leaves the set the settings, the
  // filters and the sort choices are built from, so the reader cannot restore
  // it — and a stored layout naming it does not bring it back either.
  it('drops a withheld column from every set', () => {
    const { columns, visibleColumns } = resolveEntityTableColumns<Gadget>(
      described(),
      [],
      { order: ['code', 'name', 'id'] },
      ['code'],
    );
    expect(names(columns)).toEqual(['name']);
    expect(names(visibleColumns)).toEqual(['name']);
  });

  it('withholds a column a slot added', () => {
    const { columns } = resolveEntityTableColumns<Gadget>(
      described(),
      [{ field: 'margin', label: 'Margin', type: 'number' }],
      {},
      ['margin'],
    );
    expect(names(columns)).toEqual(['code', 'name']);
  });

  it('refuses to withhold a column it does not have', () => {
    expect(() =>
      resolveEntityTableColumns<Gadget>(described(), [], {}, ['vendor']),
    ).toThrow(/"vendor", which is not one of its columns/);
  });
});

describe('readEntityTableSlots', () => {
  it('sorts children by component identity and keeps the rest', () => {
    const slots = readEntityTableSlots<Gadget>([
      <EntityColumn<Gadget> key="a" field="code" label="SKU" />,
      <EntityColumn<Gadget> key="b" field="name" />,
      <EntityTableHeader<Gadget> key="h" render={() => null} />,
      <EntityTableRow<Gadget> key="r" render={() => null} />,
      <EntityTableToolbar key="t">
        <span>export</span>
      </EntityTableToolbar>,
      <p key="p">footnote</p>,
    ]);

    expect(slots.columns.map(column => column.field)).toEqual(['code', 'name']);
    expect(slots.header).toBeDefined();
    expect(slots.row).toBeDefined();
    expect(slots.toolbar).toBeDefined();
    expect(slots.rest).toHaveLength(1);
  });

  it('treats a table with no children as fully metadata-driven', () => {
    const slots = readEntityTableSlots<Gadget>(undefined);
    expect(slots.columns).toEqual([]);
    expect(slots.header).toBeUndefined();
    expect(slots.rest).toEqual([]);
  });
});
