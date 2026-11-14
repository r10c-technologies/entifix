import {
  accessor,
  describeEntityColumns,
  type Entity,
  entity,
  type EntityId,
  type EntityRowDraft,
  newRowKey,
} from '@entifix/core';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, userEvent, within } from 'storybook/test';

import {
  type ReferenceLabelLookup,
  ReferenceLabelsProvider,
  type ReferenceLabelState,
} from '../../utils/reference-labels.js';
import { EntityDetailGrid } from '../entity-detail-grid/entity-detail-grid.js';
import { EntityForm } from '../entity-form/entity-form.js';
import { EntityTable } from './entity-table.js';

/**
 * A shipment line: the offering it carries, in another store.
 */
class StoryShipmentLine {
  #offeringId = '';
  #quantity = 0;

  @accessor({
    type: 'string',
    label: 'Oferta',
    references: { entity: 'catalog:offering' },
  })
  get offeringId(): string {
    return this.#offeringId;
  }
  set offeringId(value: string) {
    this.#offeringId = value;
  }

  @accessor({ type: 'number', label: 'Cantidad' })
  get quantity(): number {
    return this.#quantity;
  }
  set quantity(value: number) {
    this.#quantity = value;
  }
}

/**
 * Shaped like a shipment: its first filled-in member is its order's id, and
 * what it is called is the offering it ships — a reference another store names.
 */
@entity({
  domain: 'shipping',
  key: 'story-shipment',
  labelMember: 'offeringId',
})
class StoryShipment implements Entity {
  #id?: EntityId;
  #orderId = '';
  #offeringId = '';
  #lines: readonly StoryShipmentLine[] = [];

  @accessor({ type: 'id', label: 'ID' })
  get id(): EntityId {
    return this.#id;
  }
  set id(value: EntityId) {
    this.#id = value;
  }

  @accessor({
    type: 'string',
    label: 'Pedido',
    references: { entity: 'sales:order' },
  })
  get orderId(): string {
    return this.#orderId;
  }
  set orderId(value: string) {
    this.#orderId = value;
  }

  @accessor({
    type: 'string',
    label: 'Oferta',
    references: { entity: 'catalog:offering' },
  })
  get offeringId(): string {
    return this.#offeringId;
  }
  set offeringId(value: string) {
    this.#offeringId = value;
  }

  @accessor({
    type: 'composition',
    label: 'Líneas',
    childType: () => StoryShipmentLine,
  })
  get lines(): readonly StoryShipmentLine[] {
    return this.#lines;
  }
  set lines(value: readonly StoryShipmentLine[]) {
    this.#lines = value;
  }
}

/** Every state a reference can be in, by the offering it names. */
const STATES: Record<string, ReferenceLabelState> = {
  'offering-10': { status: 'named', label: 'Brida de acero' },
  'offering-11': { status: 'resolving' },
  'offering-12': { status: 'notFound' },
  'offering-13': { status: 'failed' },
};

/**
 * Offerings are registered and orders are not, so an order id shows the
 * fifth state: the raw id, muted — the developer's cue.
 */
const lookup: ReferenceLabelLookup = {
  label: (entityKey, id) =>
    entityKey === 'catalog:offering'
      ? (STATES[id] ?? { status: 'notFound' })
      : { status: 'unregistered' },
  noun: entityKey =>
    entityKey === 'catalog:offering'
      ? { name: 'Offering', key: 'oferta' }
      : undefined,
};

const shipment = (id: string, offeringId: string) => {
  const record = new StoryShipment();
  record.id = id;
  record.orderId = `79ce50c8-0a1b-4c2d-8e3f-${id.padStart(12, '0')}`;
  record.offeringId = offeringId;
  return record;
};

const SHIPMENTS = Object.keys(STATES).map((offeringId, index) =>
  shipment(String(index + 1), offeringId),
);

const LINES = describeEntityColumns(StoryShipment).find(
  column => column.name === 'lines',
) as ReturnType<typeof describeEntityColumns>[number];

const LINE_ROWS: EntityRowDraft[] = Object.keys(STATES).map(
  (offeringId, index) => ({
    $key: newRowKey(),
    offeringId,
    quantity: String(index + 1),
  }),
);

const noop = () => undefined;

const VALUES = {
  id: '1',
  orderId: SHIPMENTS[0]?.orderId ?? '',
  offeringId: 'offering-10',
};

const table = (items: StoryShipment[]) => (
  <EntityTable<StoryShipment>
    entityConstructor={StoryShipment}
    items={items}
    totalItems={items.length}
    page={1}
    pageSize={10}
    onPageChange={noop}
    onPageSizeChange={noop}
    hrefFor={id => `#shipment-${String(id)}`}
    selection={{ mode: 'ids', ids: new Set() }}
    onSelectionChange={noop}
  />
);

const meta: Meta = {
  title: 'Organisms/References',
  parameters: {
    layout: 'padded',
    gate: { viewport: { width: 1680, height: 1200 } },
  },
};

export default meta;
type Story = StoryObj;

/**
 * One reference in each of its five states — named, resolving, not found,
 * failed, and unregistered — in the table's grid, its cards, a read form and
 * a composition's read grid. The same renderer is behind all four.
 */
export const InEveryOrganism: Story = {
  render: () => (
    <ReferenceLabelsProvider lookup={lookup}>
      <div className="flex flex-col gap-l">
        <div data-testid="wide" style={{ width: 1200 }}>
          {table(SHIPMENTS)}
        </div>
        <div data-testid="narrow" style={{ width: 400 }}>
          {table(SHIPMENTS.slice(0, 1))}
        </div>
        <EntityForm<StoryShipment>
          entityConstructor={StoryShipment}
          mode="read"
          values={VALUES}
          onFieldChange={noop}
        />
        <EntityForm<StoryShipment>
          entityConstructor={StoryShipment}
          mode="edit"
          values={VALUES}
          onFieldChange={noop}
          deletePolicy="typed"
          onDelete={noop}
        />
        <EntityDetailGrid
          descriptor={LINES}
          rows={LINE_ROWS}
          onRowsChange={noop}
          editing={false}
        />
      </div>
    </ReferenceLabelsProvider>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const wide = within(canvas.getByTestId('wide'));

    // The row is named by the offering it ships, never by its order's id.
    await expect(
      wide.getByRole('checkbox', { name: 'Seleccionar Brida de acero' }),
    ).toBeInTheDocument();
    // An offering that could not be read reads as its noun and short id.
    await expect(
      wide.getByRole('checkbox', { name: 'Seleccionar oferta offering-12' }),
    ).toBeInTheDocument();

    // The card's heading is the same name.
    const narrow = within(canvas.getByTestId('narrow'));
    await expect(
      narrow.getByRole('article', { name: 'Brida de acero' }),
    ).toBeInTheDocument();

    // No name anywhere quotes more than eight characters of an id.
    for (const box of canvas.getAllByRole('checkbox')) {
      await expect(box.getAttribute('aria-label') ?? '').not.toMatch(
        /[0-9a-f]{9,}/,
      );
    }

    // The form's typed delete asks for the same name.
    await userEvent.click(canvas.getByRole('button', { name: 'Eliminar' }));
    const dialog = within(document.body).getByRole('alertdialog');
    await expect(dialog).toHaveAccessibleName('¿Eliminar Brida de acero?');
    await userEvent.keyboard('{Escape}');
  },
};
