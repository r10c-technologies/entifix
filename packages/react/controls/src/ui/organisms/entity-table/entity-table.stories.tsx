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

import { EntityTable } from './entity-table.js';

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

  // Wide enough that three columns no longer fit in 400px: 6 + 16 + 6 = 28rem.
  @accessor({ type: 'string', label: 'Name', minWidth: 16 })
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
function SortAndFilterDemo() {
  const [sorting, setSorting] = useState<EntitySorting<StoryWidget>>({});
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

/** A filter emptied the list: it says so, and offers Clear filters. */
export const NoResults: Story = {
  render: () => (
    <EntityTable<StoryWidget>
      entityConstructor={StoryWidget}
      items={[]}
      isLoading={false}
      {...pager}
      totalItems={0}
      filtering={{
        operator: 'and',
        values: [{ property: 'name', operator: 'like', value: 'zz' }],
      }}
      onFilteringChange={() => undefined}
    />
  ),
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
