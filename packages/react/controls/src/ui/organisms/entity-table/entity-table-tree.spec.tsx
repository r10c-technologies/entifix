import {
  accessor,
  emptySelection,
  type Entity,
  entity,
  type EntityId,
  type EntitySelection,
} from '@entifix/core';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { EntityTable } from './entity-table.js';
import { shownTreeRows, treeRows } from './entity-table-tree.js';

@entity({ key: 'folder' })
class Folder implements Entity {
  #id?: EntityId;
  #parentId?: string;
  #name?: string;

  @accessor({ type: 'id', label: 'ID', hidden: true })
  get id(): EntityId {
    return this.#id;
  }
  set id(value: EntityId) {
    this.#id = value;
  }

  @accessor({ type: 'string', label: 'Name' })
  get name(): string | undefined {
    return this.#name;
  }
  set name(value: string | undefined) {
    this.#name = value;
  }

  @accessor({ type: 'id', label: 'Parent', parent: true })
  get parentId(): string | undefined {
    return this.#parentId;
  }
  set parentId(value: string | undefined) {
    this.#parentId = value;
  }
}

const folder = (id: string, name: string, parentId?: string): Folder => {
  const one = new Folder();
  one.id = id;
  one.name = name;
  one.parentId = parentId;
  return one;
};

// Sorted by name, the way a load answers: the table must nest it, not re-sort.
const ITEMS = [
  folder('desk', 'Desk lamps', 'lighting'),
  folder('garden', 'Garden'),
  folder('home', 'Home'),
  folder('lighting', 'Lighting', 'home'),
];

const pager = {
  isLoading: false,
  totalItems: ITEMS.length,
  currentPage: 1,
  pageSize: 10,
  onPageChange: () => undefined,
};

/** The names in the grid's first column, in the order on screen. */
const gridNames = () =>
  within(screen.getAllByRole('table')[0] as HTMLElement)
    .getAllByRole('row')
    .slice(1)
    .map(row => within(row).getAllByRole('cell')[0]?.textContent);

describe('an EntityTable over an entity that declares a parent', () => {
  it('nests each record under its parent, depth first', () => {
    render(
      <EntityTable<Folder>
        entityConstructor={Folder}
        items={ITEMS}
        showControls={false}
        {...pager}
      />,
    );

    expect(gridNames()).toEqual(['Garden', 'Home', 'Lighting', 'Desk lamps']);
  });

  it('collapses and expands a subtree from its toggle', async () => {
    const user = userEvent.setup();
    render(
      <EntityTable<Folder>
        entityConstructor={Folder}
        items={ITEMS}
        showControls={false}
        {...pager}
      />,
    );

    const toggle = screen.getAllByRole('button', { name: 'Contraer Home' })[0];
    expect(toggle).toHaveAttribute('aria-expanded', 'true');

    await user.click(toggle as HTMLElement);
    expect(gridNames()).toEqual(['Garden', 'Home']);
    const collapsed = screen.getAllByRole('button', {
      name: 'Expandir Home',
    })[0];
    expect(collapsed).toHaveAttribute('aria-expanded', 'false');

    await user.click(collapsed as HTMLElement);
    expect(gridNames()).toEqual(['Garden', 'Home', 'Lighting', 'Desk lamps']);
  });

  it('offers no toggle on a record without children', () => {
    render(
      <EntityTable<Folder>
        entityConstructor={Folder}
        items={ITEMS}
        showControls={false}
        {...pager}
      />,
    );

    expect(screen.queryByRole('button', { name: /Garden/ })).toBeNull();
  });

  /** The range runs over the rows as shown, not in the order they loaded. */
  it('shift-selects the rows between two boxes in the order on screen', async () => {
    const user = userEvent.setup();
    const onSelectionChange = vi.fn<(next: EntitySelection<Folder>) => void>();
    const view = render(
      <EntityTable<Folder>
        entityConstructor={Folder}
        items={ITEMS}
        showControls={false}
        {...pager}
        selection={emptySelection<Folder>()}
        onSelectionChange={onSelectionChange}
      />,
    );
    const box = (name: string) =>
      screen.getAllByRole('checkbox', { name: `Seleccionar ${name}` })[0];

    await user.click(box('Home') as HTMLElement);
    const afterFirst = onSelectionChange.mock.lastCall?.[0];
    view.rerender(
      <EntityTable<Folder>
        entityConstructor={Folder}
        items={ITEMS}
        showControls={false}
        {...pager}
        selection={afterFirst}
        onSelectionChange={onSelectionChange}
      />,
    );
    await user.keyboard('{Shift>}');
    await user.click(box('Desk lamps') as HTMLElement);
    await user.keyboard('{/Shift}');

    const selected = onSelectionChange.mock.lastCall?.[0];
    expect(selected?.mode).toBe('ids');
    expect(
      [...(selected?.mode === 'ids' ? selected.ids : [])].map(String).sort(),
    ).toEqual(['desk', 'home', 'lighting']);
  });
});

describe('treeRows', () => {
  it('leaves an entity that is not a tree as it came', () => {
    const rows = treeRows(ITEMS, undefined);

    expect(rows.map(row => [row.item.id, row.depth])).toEqual([
      ['desk', 0],
      ['garden', 0],
      ['home', 0],
      ['lighting', 0],
    ]);
  });

  /** A record that would vanish from a listing is a defect nobody sees. */
  it('keeps records on a cycle, last, at depth 0', () => {
    const keys = {
      idOf: (item: Folder) => String(item.id),
      parentOf: (item: Folder) => item.parentId,
    };
    const rows = treeRows(
      [folder('a', 'A', 'b'), folder('b', 'B', 'a'), folder('r', 'Root')],
      keys,
    );

    expect(rows.map(row => [row.item.id, row.depth])).toEqual([
      ['r', 0],
      ['a', 0],
      ['b', 0],
    ]);
  });
});

describe('shownTreeRows', () => {
  it('hides every row under a collapsed record', () => {
    const keys = {
      idOf: (item: Folder) => String(item.id),
      parentOf: (item: Folder) => item.parentId,
    };
    const rows = treeRows(ITEMS, keys);

    expect(
      shownTreeRows(rows, new Set(['home'])).map(row => row.item.id),
    ).toEqual(['garden', 'home']);
    expect(shownTreeRows(rows, new Set())).toHaveLength(4);
  });
});
