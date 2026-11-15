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
import { expect, within } from 'storybook/test';

import { EntityForm } from '../entity-form/entity-form.js';
import { EntityTable } from './entity-table.js';

const STATUSES = [
  'draft',
  'awaiting',
  'dispatched',
  'delivered',
  'refused',
] as const;

/**
 * An order whose status declares a tone per value: `draft` is left out, so it
 * reads neutral. Its payment method is an enum too, and declares none — it is
 * not a status, and stays text everywhere.
 */
@entity({ key: 'story-toned-order', labelMember: 'name' })
class StoryTonedOrder implements Entity {
  #id?: EntityId;
  #name = '';
  #status = 'draft';
  #method = 'card';

  constructor(id?: string, status = 'draft', method = 'card') {
    this.#id = id;
    this.#name = `Pedido ${id ?? ''}`;
    this.#status = status;
    this.#method = method;
  }

  @accessor({ type: 'id', label: 'ID' })
  get id(): EntityId {
    return this.#id;
  }
  set id(value: EntityId) {
    this.#id = value;
  }

  @accessor({ type: 'string', label: 'Pedido' })
  get name(): string {
    return this.#name;
  }
  set name(value: string) {
    this.#name = value;
  }

  @accessor({
    type: 'enum',
    label: 'Estado',
    enumValues: STATUSES,
    enumTones: {
      awaiting: 'warning',
      dispatched: 'info',
      delivered: 'success',
      refused: 'danger',
    },
  })
  get status(): string {
    return this.#status;
  }
  set status(value: string) {
    this.#status = value;
  }

  @accessor({ type: 'enum', label: 'Pago', enumValues: ['card', 'cash'] })
  get method(): string {
    return this.#method;
  }
  set method(value: string) {
    this.#method = value;
  }
}

const ROWS = STATUSES.map(
  (status, index) =>
    new StoryTonedOrder(String(index + 1), status, index % 2 ? 'cash' : 'card'),
);

function Orders({ width }: { width: string }) {
  const [selection, setSelection] =
    useState<EntitySelection<StoryTonedOrder>>(
      emptySelection<StoryTonedOrder>(),
    );
  return (
    <div data-testid={width} style={{ width, flexShrink: 0 }}>
      <EntityTable<StoryTonedOrder>
        entityConstructor={StoryTonedOrder}
        items={ROWS}
        isLoading={false}
        totalItems={ROWS.length}
        currentPage={1}
        pageSize={10}
        onPageChange={() => undefined}
        hrefFor={id => `#order-${String(id)}`}
        selection={selection}
        onSelectionChange={setSelection}
      />
    </div>
  );
}

const meta: Meta = {
  title: 'Organisms/EntityTableStatus',
  parameters: { gate: { viewport: { width: 1280, height: 1000 } } },
};

export default meta;
type Story = StoryObj;

/**
 * A toned status reads as a tag beside its words in the grid; the payment
 * method, an enum with no tones, stays text.
 */
export const Grid: Story = {
  render: () => <Orders width="60rem" />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const table = within(canvas.getByRole('table'));
    await expect(table.getByText('refused')).toHaveAttribute(
      'data-tone',
      'danger',
    );
    await expect(table.getByText('draft')).toHaveAttribute(
      'data-tone',
      'neutral',
    );
    for (const method of table.getAllByText(/^(card|cash)$/)) {
      await expect(method).not.toHaveAttribute('data-tone');
    }
  },
};

/** Where the list turns into cards, the status is the card's badge, still a tag. */
export const Cards: Story = {
  render: () => <Orders width="20rem" />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.queryByRole('table')).toBeNull();
    const cards = canvas.getAllByRole('article');
    await expect(cards).toHaveLength(ROWS.length);
    await expect(
      within(cards[3] as HTMLElement).getByText('delivered'),
    ).toHaveAttribute('data-tone', 'success');
  },
};

/** A record read on its own page shows the same tag. */
export const ReadForm: Story = {
  render: () => {
    const order = ROWS[3] as StoryTonedOrder;
    return (
      <EntityForm<StoryTonedOrder>
        entityConstructor={StoryTonedOrder}
        entity={order}
        values={{
          id: '4',
          name: order.name,
          status: order.status,
          method: order.method,
        }}
        mode="read"
        onFieldChange={() => undefined}
        onSubmit={() => undefined}
      />
    );
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText('delivered')).toHaveAttribute(
      'data-tone',
      'success',
    );
    await expect(canvas.getByText('cash')).not.toHaveAttribute('data-tone');
  },
};
