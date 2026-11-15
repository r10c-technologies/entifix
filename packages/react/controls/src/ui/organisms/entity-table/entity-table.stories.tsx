import {
  accessor,
  applyFiltering,
  applySorting,
  type BulkOutcome,
  type Entity,
  entity,
  type EntityAction,
  type EntityId,
  type EntitySelection,
  type EntitySorting,
  type FilterGroup,
  Unavailable,
} from '@entifix/core';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { expect, userEvent, waitFor, within } from 'storybook/test';

import { Money } from '../../atoms/money/money.js';
import { EntityTable } from './entity-table.js';
import { EntityColumn } from './entity-table-slots.js';

/**
 * A decorated fixture, because the table builds itself from metadata — there is
 * no way to show it without an entity. The `Symbol.metadata` polyfill installs
 * itself on the first import from `@entifix/core`, so nothing else is
 * needed to make the decorators work here.
 */
@entity({ key: 'story-widget' })
class StoryWidget implements Entity {
  #id?: EntityId;
  #name?: string;
  #stock = 0;

  constructor(id?: EntityId, name?: string, stock = 0) {
    this.#id = id;
    this.#name = name;
    this.#stock = stock;
  }

  @accessor({ type: 'id', label: 'ID' })
  get id(): EntityId {
    return this.#id;
  }
  set id(value: EntityId) {
    this.#id = value;
  }

  // Wide enough that a row's essentials no longer fit in 400px (25rem): the
  // name and the stock, 20 + 6 = 26rem — the id is off the card, so it does
  // not count.
  @accessor({ type: 'string', label: 'Name', minWidth: 20 })
  get name(): string | undefined {
    return this.#name;
  }
  set name(value: string | undefined) {
    this.#name = value;
  }

  @accessor({ type: 'number', label: 'Units in stock' })
  get stock(): number {
    return this.#stock;
  }
  set stock(value: number) {
    this.#stock = value;
  }
}

const WIDGETS = [
  new StoryWidget('w-1', 'Sprocket', 1200),
  new StoryWidget('w-2', 'Flange', 87),
  new StoryWidget('w-3', 'Grommet', 4310),
];

const pager = {
  totalItems: WIDGETS.length,
  currentPage: 1,
  pageSize: 10,
  onPageChange: () => undefined,
};

const meta = {
  title: 'Organisms/EntityTable',
  component: EntityTable,
  tags: ['autodocs'],
  parameters: { layout: 'padded' },
} satisfies Meta<typeof EntityTable>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: () => (
    <EntityTable<StoryWidget>
      entityConstructor={StoryWidget}
      items={WIDGETS}
      isLoading={false}
      {...pager}
    />
  ),
};

/**
 * The first load. One shimmer cell per visible column rather than a single
 * full-width blob, so the swap to real rows shifts nothing sideways.
 */
export const Loading: Story = {
  render: () => (
    <EntityTable<StoryWidget>
      entityConstructor={StoryWidget}
      items={[]}
      isLoading
      {...pager}
      totalItems={0}
    />
  ),
};

/**
 * A refetch over rows that already arrived keeps them, at full contrast, and
 * marks the region busy. A skeleton here would be a grey flash on every
 * pagination click, and dimming took the text under its contrast.
 */
export const Reloading: Story = {
  render: () => (
    <EntityTable<StoryWidget>
      entityConstructor={StoryWidget}
      items={WIDGETS}
      isLoading
      {...pager}
    />
  ),
};

/**
 * Nothing yet: the region's empty state alone — no table header over no rows,
 * no empty card list — with the result still announced.
 */
export const Empty: Story = {
  render: () => (
    <EntityTable<StoryWidget>
      entityConstructor={StoryWidget}
      items={[]}
      isLoading={false}
      {...pager}
      totalItems={0}
    />
  ),
  play: async ({ canvasElement }) => {
    await expect(canvasElement.querySelector('table')).toBeNull();
    await expect(canvasElement.querySelector('ul[role=list]')).toBeNull();
    // The result is still said, by the polite status beside the toolbar.
    await expect(
      within(canvasElement).getAllByRole('status').length,
    ).toBeGreaterThan(0);
  },
};

/** The verbs a selection can be acted on with, as the service reports them. */
const RETIRE = {
  key: 'retire',
  binding: 'collection' as const,
  placement: 'context-dependent' as const,
  labelKey: 'entity:product-brand.useCases.retire',
  confirm: {
    tone: 'destructive' as const,
    messageKey: 'entity:product-brand.useCases.retireConfirm',
  },
};

const METADATA = {
  actions: ['read', 'write', 'delete'] as EntityAction[],
  useCases: [RETIRE],
};

/**
 * A live selection: tick rows, watch the count, run the verb.
 *
 * Stateful because the selection is **controlled from above the table** — it
 * has to survive pagination, and the page owns the pager. A story holding it in
 * `useState` is the same arrangement a real page uses.
 */
function SelectableDemo({
  outcomes,
  running = false,
  total = WIDGETS.length,
}: {
  outcomes?: BulkOutcome[];
  running?: boolean;
  total?: number;
}) {
  const [selection, setSelection] = useState<EntitySelection<StoryWidget>>({
    mode: 'ids',
    ids: new Set(['w-1']),
  });

  return (
    <EntityTable<StoryWidget>
      entityConstructor={StoryWidget}
      items={WIDGETS}
      isLoading={false}
      {...pager}
      totalItems={total}
      selection={selection}
      onSelectionChange={setSelection}
      metadata={METADATA}
      onBulkUseCase={() => undefined}
      bulkOutcomes={outcomes}
      onBulkDismiss={() => undefined}
      onBulkRetry={() => undefined}
      isBulkRunning={running}
    />
  );
}

export const Selection: Story = {
  render: () => <SelectableDemo />,
};

/**
 * The escalation, and it is a **separate affordance carrying the count**: this
 * page holds three rows and the store holds 3.200, so "select all matching" is
 * offered only once the page itself is fully ticked. Acting on 3 rows and
 * acting on 3.200 are different decisions.
 */
export const SelectAllMatching: Story = {
  render: () => <SelectAllMatchingDemo />,
};

function SelectAllMatchingDemo() {
  const [selection, setSelection] = useState<EntitySelection<StoryWidget>>({
    mode: 'ids',
    ids: new Set(WIDGETS.map(widget => widget.id)),
  });

  return (
    <EntityTable<StoryWidget>
      entityConstructor={StoryWidget}
      items={WIDGETS}
      isLoading={false}
      {...pager}
      totalItems={3200}
      selection={selection}
      onSelectionChange={setSelection}
      metadata={METADATA}
      onBulkUseCase={() => undefined}
    />
  );
}

/** Every verb disabled while a run is in flight. */
export const BulkRunning: Story = {
  render: () => <SelectableDemo running />,
};

/**
 * The requirement, not an edge case. Forty selected, three fail — a single
 * notice would lie either way, so both counts are stated and every failure is
 * named with its own reason and its own retry.
 */
export const BulkPartialFailure: Story = {
  render: () => (
    <SelectableDemo
      outcomes={[
        { id: 'w-1', ok: true },
        { id: 'w-2', ok: false, code: 'alreadyRetired' },
        { id: 'w-3', ok: false, code: 'forbidden' },
      ]}
    />
  ),
};

/**
 * Sorted from a header and filtered from the panel, with what changed said in
 * the status region: a list a keyboard and a screen reader can drive whole.
 */
function SortAndFilterDemo({
  initialSorting = {},
}: {
  readonly initialSorting?: EntitySorting<StoryWidget>;
}) {
  const [sorting, setSorting] =
    useState<EntitySorting<StoryWidget>>(initialSorting);
  const [filtering, setFiltering] = useState<FilterGroup<StoryWidget>>({
    operator: 'and',
    values: [],
  });
  const items = applySorting(applyFiltering(WIDGETS, [filtering]), [sorting]);

  return (
    <EntityTable<StoryWidget>
      entityConstructor={StoryWidget}
      items={items}
      isLoading={false}
      {...pager}
      totalItems={items.length}
      sorting={sorting}
      filtering={filtering}
      onSortingChange={setSorting}
      onFilteringChange={setFiltering}
    />
  );
}

/**
 * A list that opens sorted — a worklist putting what needs acting on first.
 * The header says so before anyone touches it, and a click still moves it.
 */
export const OpensSorted: Story = {
  render: () => (
    <SortAndFilterDemo
      initialSorting={{ 0: { property: 'name', type: 'desc' } }}
    />
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const name = canvas.getByRole('columnheader', { name: /Name/ });
    await expect(name).toHaveAttribute('aria-sort', 'descending');

    // Descending is the end of the header's cycle, so a click lifts it.
    await userEvent.click(within(name).getByRole('button'));
    await expect(name).not.toHaveAttribute('aria-sort');
  },
};

export const SortAndFilter: Story = {
  render: () => <SortAndFilterDemo />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const name = canvas.getByRole('columnheader', { name: /Name/ });

    await userEvent.click(within(name).getByRole('button'));
    await expect(name).toHaveAttribute('aria-sort', 'ascending');

    await userEvent.click(canvas.getByRole('button', { name: 'Filtros' }));
    await userEvent.click(
      canvas.getByRole('button', { name: 'Añadir filtro' }),
    );
    await userEvent.type(
      canvas.getByRole('textbox', { name: 'Valor del filtro' }),
      'Spro',
    );
    await userEvent.click(
      canvas.getByRole('button', { name: 'Aplicar filtros' }),
    );

    await waitFor(() =>
      expect(canvas.getAllByRole('status')[0]).toHaveTextContent('1 resultado'),
    );
  },
};

/** A verb on one record: what the row menu holds. */
const ARCHIVE = {
  key: 'archive',
  binding: 'entity' as const,
  placement: 'context-dependent' as const,
  labelKey: 'entity:product-brand.useCases.retire',
};

/**
 * The table switches by the room its own container has, not the viewport's:
 * the same table in 400px shows cards, and in 1200px a grid — side by side in
 * one viewport, as a split view or a drawer puts them.
 */
export const Containers: Story = {
  parameters: { gate: { viewport: { width: 1680, height: 900 } } },
  render: () => (
    <div className="flex items-start gap-s">
      <div data-testid="narrow" style={{ width: 400, flexShrink: 0 }}>
        <EntityTable<StoryWidget>
          entityConstructor={StoryWidget}
          items={WIDGETS}
          isLoading={false}
          {...pager}
          hrefFor={id => `#${String(id)}`}
        />
      </div>
      <div data-testid="wide" style={{ width: 1200, flexShrink: 0 }}>
        <EntityTable<StoryWidget>
          entityConstructor={StoryWidget}
          items={WIDGETS}
          isLoading={false}
          {...pager}
          hrefFor={id => `#${String(id)}`}
        />
      </div>
    </div>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const narrow = within(canvas.getByTestId('narrow'));
    const wide = within(canvas.getByTestId('wide'));

    await expect(narrow.queryByRole('table')).toBeNull();
    const cards = narrow.getAllByRole('article');
    await expect(cards).toHaveLength(WIDGETS.length);
    await expect(narrow.getAllByRole('listitem')).toHaveLength(WIDGETS.length);
    for (const card of cards) {
      await expect(within(card).getAllByRole('heading')).toHaveLength(1);
      await expect(within(card).getAllByRole('link')).toHaveLength(1);
    }

    await expect(wide.getByRole('table')).toBeVisible();
    await expect(wide.queryByRole('article')).toBeNull();
  },
};

/** Selection and the row menu, carried across the switch from grid to cards. */
function ResizableDemo() {
  const [narrow, setNarrow] = useState(false);
  const [selection, setSelection] = useState<EntitySelection<StoryWidget>>({
    mode: 'ids',
    ids: new Set(),
  });
  return (
    <div className="flex flex-col gap-s">
      <button type="button" onClick={() => setNarrow(current => !current)}>
        {narrow ? 'Widen' : 'Narrow'}
      </button>
      <div data-testid="frame" style={{ width: narrow ? 400 : 1200 }}>
        <EntityTable<StoryWidget>
          entityConstructor={StoryWidget}
          items={WIDGETS}
          isLoading={false}
          {...pager}
          selection={selection}
          onSelectionChange={setSelection}
          metadata={{ ...METADATA, useCases: [RETIRE, ARCHIVE] }}
          onBulkUseCase={() => undefined}
          onUseCase={() => undefined}
        />
      </div>
    </div>
  );
}

export const ResizeKeepsSelection: Story = {
  parameters: { gate: { viewport: { width: 1280, height: 800 } } },
  render: () => <ResizableDemo />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const frame = within(canvas.getByTestId('frame'));
    const visible = (elements: HTMLElement[]) =>
      elements.find(element => element.checkVisibility());

    await userEvent.click(
      visible(
        frame.getAllByRole('checkbox', { name: 'Seleccionar Flange' }),
      ) as HTMLElement,
    );
    await userEvent.click(canvas.getByRole('button', { name: 'Narrow' }));

    await waitFor(() => expect(frame.queryByRole('table')).toBeNull());
    const card = frame.getByRole('article', { name: 'Flange' });
    await expect(
      within(card).getByRole('checkbox', { name: 'Seleccionar Flange' }),
    ).toBeChecked();
    await expect(
      within(card).getByRole('button', { name: 'Acciones para Flange' }),
    ).toBeVisible();

    // A box ticked on a card keeps focus: the bulk bar that appears above the
    // cards must not take the card out from under it.
    const grommet = within(frame.getByRole('article', { name: 'Grommet' }));
    const box = grommet.getByRole('checkbox', { name: 'Seleccionar Grommet' });
    await userEvent.click(box);
    await expect(box).toBeChecked();
    await expect(box).toHaveFocus();
  },
};

function FilteredEmpty() {
  const [filtering, setFiltering] = useState<FilterGroup<StoryWidget>>({
    operator: 'and',
    values: [{ property: 'name', operator: 'like', value: 'zz' }],
  });
  const items = filtering.values.length === 0 ? WIDGETS : [];
  return (
    <EntityTable<StoryWidget>
      entityConstructor={StoryWidget}
      items={items}
      isLoading={false}
      {...pager}
      totalItems={items.length}
      filtering={filtering}
      onFilteringChange={setFiltering}
    />
  );
}

/**
 * A filter emptied the list: it says so, and offers Clear filters — with no
 * table under it. Clearing brings the rows back, and focus stays on the
 * control that filters rather than falling to the page.
 */
export const NoResults: Story = {
  render: () => <FilteredEmpty />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvasElement.querySelector('table')).toBeNull();
    await expect(canvasElement.querySelector('ul[role=list]')).toBeNull();
    await expect(canvas.getAllByRole('status').length).toBeGreaterThan(0);

    await userEvent.click(
      canvas.getByRole('button', { name: 'Limpiar filtros' }),
    );
    // Back in the DOM: which layout shows is the container's call.
    await waitFor(() =>
      expect(canvasElement.querySelector('table')).not.toBeNull(),
    );
    await expect(canvas.getByRole('button', { name: 'Filtros' })).toHaveFocus();
  },
};

/** A load that failed, over the rows from before it, with Retry. */
export const LoadError: Story = {
  render: () => (
    <EntityTable<StoryWidget>
      entityConstructor={StoryWidget}
      items={WIDGETS}
      isLoading={false}
      {...pager}
      error={new Unavailable({})}
      onRetry={() => undefined}
    />
  ),
};

/**
 * Columns whose values live in another entity — a price, a picture — as a
 * host's related columns render them: read through the target's own
 * descriptor, and never sortable, so their headers carry no sort button and no
 * `aria-sort`.
 */
export const RelatedColumns: Story = {
  parameters: { gate: { viewport: { width: 1680, height: 900 } } },
  render: () => (
    <EntityTable<StoryWidget>
      entityConstructor={StoryWidget}
      items={WIDGETS}
      isLoading={false}
      {...pager}
      onSortingChange={() => undefined}
    >
      <EntityColumn<StoryWidget>
        field="price"
        label="Precio"
        type="number"
        render={widget => (
          <Money
            amount={(widget.stock ?? 0) * 7}
            currency="GTQ"
            unit="minor"
            locale="es"
          />
        )}
      />
      <EntityColumn<StoryWidget>
        field="picture"
        label="Imagen"
        render={widget => (
          <img
            src={`data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='32' height='32'/%3E`}
            alt={widget.name ?? ''}
            width={32}
            height={32}
          />
        )}
      />
    </EntityTable>
  ),
  play: async ({ canvasElement }) => {
    const table = within(canvasElement).getByRole('table');
    for (const name of ['Precio', 'Imagen']) {
      const header = within(table).getByRole('columnheader', { name });
      await expect(header).not.toHaveAttribute('aria-sort');
      await expect(within(header).queryByRole('button')).toBeNull();
    }
  },
};
