import {
  accessor,
  emptySelection,
  type Entity,
  entity,
  type EntityId,
  type EntitySelection,
} from '@entifix/core';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { expect, userEvent, waitFor, within } from 'storybook/test';

import { EntityTable } from './entity-table.js';
import { EntityColumn } from './entity-table-slots.js';

const METAS = ['m0', 'm1', 'm2', 'm3', 'm4', 'm5', 'm6', 'm7'] as const;

/**
 * Eleven columns, like a shipment list: an id, the title, a status and eight
 * more. Every column side by side needs about 106rem; a row needs its title,
 * its status and two more to be read as a row — about 45rem.
 */
@entity({ key: 'story-shipment-row', labelMember: 'name' })
class StoryShipmentRow implements Entity {
  #values: Record<string, string> = {};
  #id?: EntityId;

  constructor(id?: string) {
    this.#id = id;
    this.#values['name'] = `Envío ${id ?? ''}`;
    this.#values['status'] = 'open';
    for (const meta of METAS) this.#values[meta] = `${meta}-${id ?? ''}`;
  }

  @accessor({ type: 'id', label: 'ID' })
  get id(): EntityId {
    return this.#id;
  }
  set id(value: EntityId) {
    this.#id = value;
  }

  @accessor({ type: 'string', label: 'Envío', minWidth: 16 })
  get name(): string {
    return this.#values['name'] as string;
  }
  set name(value: string) {
    this.#values['name'] = value;
  }

  @accessor({ type: 'enum', label: 'Estado', enumValues: ['open', 'sent'] })
  get status(): string {
    return this.#values['status'] as string;
  }
  set status(value: string) {
    this.#values['status'] = value;
  }

  @accessor({ type: 'string', label: 'Dato 0', minWidth: 9 })
  get m0(): string {
    return this.#values['m0'] as string;
  }
  set m0(value: string) {
    this.#values['m0'] = value;
  }
  @accessor({ type: 'string', label: 'Dato 1', minWidth: 9 })
  get m1(): string {
    return this.#values['m1'] as string;
  }
  set m1(value: string) {
    this.#values['m1'] = value;
  }
  @accessor({ type: 'string', label: 'Dato 2', minWidth: 9 })
  get m2(): string {
    return this.#values['m2'] as string;
  }
  set m2(value: string) {
    this.#values['m2'] = value;
  }
  @accessor({ type: 'string', label: 'Dato 3', minWidth: 9 })
  get m3(): string {
    return this.#values['m3'] as string;
  }
  set m3(value: string) {
    this.#values['m3'] = value;
  }
  @accessor({ type: 'string', label: 'Dato 4', minWidth: 9 })
  get m4(): string {
    return this.#values['m4'] as string;
  }
  set m4(value: string) {
    this.#values['m4'] = value;
  }
  @accessor({ type: 'string', label: 'Dato 5', minWidth: 9 })
  get m5(): string {
    return this.#values['m5'] as string;
  }
  set m5(value: string) {
    this.#values['m5'] = value;
  }
  @accessor({ type: 'string', label: 'Dato 6', minWidth: 9 })
  get m6(): string {
    return this.#values['m6'] as string;
  }
  set m6(value: string) {
    this.#values['m6'] = value;
  }
  @accessor({ type: 'string', label: 'Dato 7', minWidth: 9 })
  get m7(): string {
    return this.#values['m7'] as string;
  }
  set m7(value: string) {
    this.#values['m7'] = value;
  }
}

const ROWS = ['1', '2', '3'].map(id => new StoryShipmentRow(id));

const pager = {
  totalItems: ROWS.length,
  currentPage: 1,
  pageSize: 10,
  onPageChange: () => undefined,
};

function Shipments({ width }: { width: string }) {
  const [selection, setSelection] =
    useState<EntitySelection<StoryShipmentRow>>(
      emptySelection<StoryShipmentRow>(),
    );
  return (
    <div data-testid={width} style={{ width, flexShrink: 0 }}>
      <EntityTable<StoryShipmentRow>
        entityConstructor={StoryShipmentRow}
        items={ROWS}
        isLoading={false}
        {...pager}
        hrefFor={id => `#shipment-${String(id)}`}
        selection={selection}
        onSelectionChange={setSelection}
      >
        {/* A control at the far end of the row, so a keyboard walk crosses
            the whole scrolled width. */}
        <EntityColumn<StoryShipmentRow>
          field="m7"
          render={row => <a href={`#tracking-${String(row.id)}`}>{row.m7}</a>}
        />
      </EntityTable>
    </div>
  );
}

const meta: Meta = {
  title: 'Organisms/EntityTablePivot',
  parameters: { gate: { viewport: { width: 1680, height: 1000 } } },
};

export default meta;
type Story = StoryObj;

/**
 * A grid at 60rem, scrolled sideways with its title held in view, because a
 * row's essentials fit; cards only at 30rem, where they do not. Summing every
 * column would have shown cards at both.
 */
export const EssentialColumns: Story = {
  render: () => (
    <div className="flex flex-col items-start gap-s">
      <Shipments width="60rem" />
      <Shipments width="30rem" />
    </div>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const wide = within(canvas.getByTestId('60rem'));
    const narrow = within(canvas.getByTestId('30rem'));

    await expect(narrow.queryByRole('table')).toBeNull();
    await expect(narrow.getAllByRole('article')).toHaveLength(ROWS.length);

    const table = wide.getByRole('table');
    await expect(table).toBeVisible();
    // Wider than its box: the scroll region is named and reachable by Tab.
    const region = await waitFor(() => wide.getByRole('region'));
    await expect(region).toHaveAttribute('tabindex', '0');

    // The title stays put at the inline start while the rest scrolls.
    const titleHeader = wide.getByRole('columnheader', { name: 'Envío' });
    const titleCell = wide.getByRole('link', { name: 'Envío 1' })
      .parentElement as HTMLElement;
    await expect(getComputedStyle(titleCell).position).toBe('sticky');
    await expect(getComputedStyle(titleHeader).position).toBe('sticky');

    // Tab across the first row: every focused cell is fully in view, never
    // under the sticky title.
    const box = wide.getByRole('checkbox', { name: 'Seleccionar Envío 1' });
    box.focus();
    const visible = (element: HTMLElement) => {
      const area = region.getBoundingClientRect();
      const rect = element.getBoundingClientRect();
      const title = titleCell.getBoundingClientRect();
      const clearOfTitle =
        titleCell.contains(element) || rect.left >= title.right - 1;
      return (
        clearOfTitle &&
        rect.left >= area.left - 1 &&
        rect.right <= area.right + 1
      );
    };
    for (const name of ['Envío 1', 'm7-1']) {
      await userEvent.tab();
      const focused = wide.getByRole('link', { name });
      await expect(focused).toHaveFocus();
      await waitFor(() => expect(visible(focused)).toBe(true));
    }
  },
};
