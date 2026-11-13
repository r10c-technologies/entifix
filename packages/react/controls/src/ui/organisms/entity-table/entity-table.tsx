'use client';

import {
  emptySelection,
  type Entity,
  type EntityId,
  type EntitySelection,
  type EntitySorting,
  extractMetaEntity,
  type FilterGroup,
  hierarchyOf,
  isSelected,
  queryPropertyFor,
  selectionSize,
  toggleSelected,
  type UseCaseDescriptor,
} from '@entifix/core';
import {
  Fragment,
  type ReactNode,
  useId,
  useMemo,
  useRef,
  useState,
} from 'react';

import {
  useEntityNoun,
  useLocale,
  useT,
  useTranslateKey,
} from '../../../i18n/index.js';
import {
  availableUseCases,
  renderAnchor,
  useCasesForSurface,
} from '../../actions/index.js';
import { useVerbInvoker } from '../../actions/use-verb-invoker.js';
import { Button, button } from '../../atoms/button/index.js';
import { CellValue } from '../../atoms/cell-value/index.js';
import { Checkbox } from '../../atoms/field/index.js';
import { Skeleton } from '../../atoms/skeleton/index.js';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableMessageRow,
  TableRow,
} from '../../atoms/table/index.js';
import { linkClassName } from '../../atoms/text/index.js';
import {
  ActionBar,
  type ActionBarItem,
  itemsForUseCases,
} from '../../molecules/action-bar/index.js';
import { BulkActionBar } from '../../molecules/bulk-action-bar/index.js';
import { BulkResult } from '../../molecules/bulk-result/index.js';
import { ColumnSettings } from '../../molecules/column-settings/index.js';
import { EntityRecordCard } from '../../molecules/entity-record-card/index.js';
import { FilterBuilder } from '../../molecules/filter-builder/index.js';
import { FilterChips } from '../../molecules/filter-chips/index.js';
import { LoadingBoundary } from '../../molecules/loading-boundary/index.js';
import { Pagination } from '../../molecules/pagination/index.js';
import { RegionState } from '../../molecules/region-state/index.js';
import { SortBuilder } from '../../molecules/sort-builder/index.js';
import { TableToolbar } from '../../molecules/table-toolbar/index.js';
import { useFocusOnLoss } from '../../utils/use-focus-on-arrival.js';
import type {
  EntityTableColumn,
  EntityTableProps,
} from './entity-table.types.js';
import { readEntityTableSlots } from './entity-table-slots.js';
import { shownTreeRows, TreeCell, treeRows } from './entity-table-tree.js';
import { nextHeaderSorting, sortKeys } from './header-sort.js';
import {
  ACTIONS_WIDTH,
  pivotClasses,
  pivotWidth,
  SELECTION_WIDTH,
} from './pivot.js';
import { useEntityTableColumns } from './use-entity-table-columns.js';
import { useResultAnnouncement } from './use-result-announcement.js';

type Panel = 'none' | 'filters' | 'sorting';

/**
 * How many placeholder rows the built-in skeleton draws.
 *
 * The column count is taken from the real geometry, because that is the axis a
 * mismatch shifts; the row count is capped instead of tracking `pageSize`, since
 * a fifty-row page would otherwise paint fifty shimmer rows to stand in for
 * content that arrives below the fold anyway.
 */
const SKELETON_ROW_CAP = 5;

/** How many members a card shows as meta when none declares a `card` role. */
const UNDECLARED_META_CAP = 3;

/**
 * A table that builds itself from an entity's metadata: columns, labels, value
 * formatting and the filter/sort controls all come from `@accessor()`
 * declarations, so listing a new entity needs no bespoke table.
 *
 * Three things layer on top of that default:
 * - **personalization** — column order and visibility, persisted through the
 *   UI-preferences port (so it survives reloads and can later move server-side);
 * - **responsiveness** — below `pivotBreakpoint` rows pivot into label/value
 *   cards instead of scrolling sideways;
 * - **slots** — `<EntityColumn>` / `<EntityTableHeader>` / `<EntityTableRow>` /
 *   `<EntityTableToolbar>` children override any part of the default rendering.
 */
/**
 * What a pending verb will act on once it is confirmed.
 *
 * A form has one record; a table has a row or a selection, and those reach two
 * different handlers with two different payloads. Carrying the selection itself
 * rather than reading it back at confirm time also removes a branch that could
 * not happen: the bulk bar only renders inside a truthy selection.
 */
type PendingTarget<TEntity extends Entity> =
  | { kind: 'row'; item: TEntity }
  | { kind: 'selection'; selection: EntitySelection<TEntity> };

export function EntityTable<TEntity extends Entity>({
  entityConstructor,
  isLoading,
  skeleton = true,
  error,
  items,
  totalItems,
  currentPage,
  pageSize,
  onPageChange,
  onPageSizeChange,
  hrefFor,
  newHref,
  renderLink = renderAnchor,
  onSelect,
  preferencesKey,
  showControls = true,
  pivotBreakpoint,
  filtering,
  sorting,
  onFilteringChange,
  onSortingChange,
  facets,
  selection,
  onSelectionChange,
  metadata,
  isMetadataLoading = false,
  onBulkUseCase,
  onUseCase,
  onRetry,
  bulkOutcomes,
  onBulkDismiss,
  onBulkRetry,
  isBulkRunning = false,
  children,
}: EntityTableProps<TEntity>) {
  const t = useT();
  // A descriptor's label is a runtime catalog key — the typed gate cannot see
  // it, which is why a host's catalog check is what catches a typo.
  const translateKey = useTranslateKey();
  const entityNoun = useEntityNoun();
  const metaEntity = extractMetaEntity(entityConstructor);
  const slots = readEntityTableSlots<TEntity>(children);
  const [panel, setPanel] = useState<Panel>('none');

  const { columns, visibleColumns, hidden, setPersonalization } =
    useEntityTableColumns<TEntity>(
      entityConstructor,
      slots.columns,
      items[0],
      `entity-table:${preferencesKey ?? metaEntity.key ?? metaEntity.name}`,
    );

  // A picker's table is choosing *one* value; a multi-selection there would
  // offer a set to a form member that holds a single reference, and the two
  // controls would fight over the same row. This is a wiring mistake rather
  // than a state, so it costs the render — the same call `EntityForm` makes
  // for a link source aimed at a member no picker can edit.
  if (onSelect !== undefined && selection !== undefined) {
    throw new Error(
      'EntityTable was given both `onSelect` and `selection`. A picker picks one ' +
        'row and a selection accumulates many, so the row control cannot be both. ' +
        'Drop `selection` inside a picker, or drop `onSelect` outside one.',
    );
  }

  /**
   * The selection, or `undefined` when the table is not selectable at all.
   *
   * One value rather than a `selection` prop beside a `selectable` boolean:
   * two of them means every render site has to re-test both, and the second
   * test is unreachable — which reads as a defensive check and is really dead
   * code the coverage gate then cannot close.
   */
  const selectionState =
    selection !== undefined && onSelectionChange !== undefined
      ? selection
      : undefined;
  const selectable = selectionState !== undefined;
  const rowUseCases = useCasesForSurface('row-menu', metadata?.useCases);
  const bulkUseCases = useCasesForSurface('bulk-bar', metadata?.useCases);
  const toolbarUseCases = useCasesForSurface(
    'table-toolbar',
    metadata?.useCases,
  );
  const hasRowMenu = rowUseCases.length > 0 && onUseCase !== undefined;

  /**
   * What a `context-independent` collection verb acts on: everything the
   * current filter matches.
   *
   * Not an empty `ids` selection, which would say "no rows" — the verb is
   * available *without* a selection precisely because its subject is the
   * collection, so the honest payload is the same filter the listing is
   * showing, and the same one a "select all matching" escalation would send.
   */
  const everythingMatching: EntitySelection<TEntity> = {
    mode: 'matching',
    filtering,
    total: totalItems,
    excluded: new Set<EntityId>(),
  };

  // Opening a record is its title's link, so a row needs an actions column
  // only to pick it or to run a verb on it.
  const hasRowAction = onSelect !== undefined || hasRowMenu;
  const columnCount =
    visibleColumns.length + (hasRowAction ? 1 : 0) + (selectable ? 1 : 0);

  /**
   * The grid and the cards are both rendered, and a container query on the
   * table's own box picks one — at the width its visible columns need. A
   * viewport breakpoint was wrong inside a split view, a drawer or a wizard
   * step, and a JS measurement would guess during SSR and correct after mount.
   */
  const pivot = pivotClasses(
    pivotWidth(
      visibleColumns,
      (selectable ? SELECTION_WIDTH : 0) + (hasRowAction ? ACTIONS_WIDTH : 0),
      pivotBreakpoint,
    ),
  );
  /**
   * The first load has nothing to show and is held with a skeleton; a refetch
   * already has rows, so it keeps them and only marks the region busy. Splitting
   * the two is what stops every pagination click flashing grey.
   */
  const isFirstLoad = isLoading && items.length === 0;

  /** `true`/omitted → the built-in default; a node → that node; `false` → none. */
  const customSkeleton = typeof skeleton === 'boolean' ? undefined : skeleton;
  const showSkeleton = isFirstLoad && skeleton !== false;
  const skeletonRows = Array.from(
    { length: Math.min(pageSize, SKELETON_ROW_CAP) },
    (_, index) => index,
  );

  /**
   * A refetch keeps its rows at full contrast and marks them `aria-busy`:
   * dimming them through opacity took the text under the contrast a reader
   * needs, on every page change.
   */
  const busy = isLoading || undefined;

  /** The column a row reads *as*: the first non-identifier one it filled in. */
  const titleColumn = (item: TEntity) =>
    visibleColumns.find(column => {
      if (column.type === 'id') return false;
      const value = (item as Record<string, unknown>)[column.name];
      return value != null && String(value) !== '';
    });

  /** The column that links to the record: one declared `card: 'title'`, else the row's title. */
  const declaredTitle = visibleColumns.find(column => column.card === 'title');
  const linkColumn = (item: TEntity) => declaredTitle ?? titleColumn(item);

  /**
   * What a record's card shows, by each member's declared `card` role or the
   * default: an id is hidden, the first enum is the badge, and up to
   * {@link UNDECLARED_META_CAP} more members are meta — a card is a summary,
   * and the grid holds the rest.
   */
  const firstEnum = visibleColumns.find(
    column => column.card === undefined && column.type === 'enum',
  );
  const roleOf = (column: EntityTableColumn<TEntity>) =>
    column.card ??
    (column.type === 'id' ? 'hidden' : column === firstEnum ? 'badge' : 'meta');
  const cardParts = (item: TEntity) => {
    const title = linkColumn(item);
    const rest = visibleColumns.filter(column => column !== title);
    let undeclared = 0;
    return {
      title,
      subtitle: rest.find(column => roleOf(column) === 'subtitle'),
      badges: rest.filter(column => roleOf(column) === 'badge'),
      meta: rest.filter(column => {
        if (roleOf(column) !== 'meta') return false;
        if (column.card !== undefined) return true;
        undeclared += 1;
        return undeclared <= UNDECLARED_META_CAP;
      }),
    };
  };

  const renderValue = (
    column: EntityTableColumn<TEntity>,
    item: TEntity,
  ): ReactNode =>
    column.render ? (
      column.render(item)
    ) : (
      <CellValue
        value={(item as Record<string, unknown>)[column.name]}
        descriptor={column}
        record={item as Record<string, unknown>}
      />
    );

  /**
   * A cell, and the row's title cell is the record's link
   * ([ADR 0026](../../../../../../../docs/adr/0026-actions-hierarchy-overflow-and-destructive-verbs.md)).
   * A column of identical "Open" links named nothing, and a reader tabbing
   * down it heard "Open" once per row; the title says which record it opens.
   * A picker's rows are chosen, not opened, so they stay plain.
   */
  const renderCell = (
    column: EntityTableColumn<TEntity>,
    item: TEntity,
  ): ReactNode => {
    const value = renderValue(column, item);
    if (hrefFor === undefined || onSelect !== undefined) return value;
    if (linkColumn(item)?.name !== column.name) return value;
    return renderLink({
      href: hrefFor(item.id),
      className: linkClassName,
      children: value,
      intent: { kind: 'open', id: item.id },
    });
  };

  /**
   * The row a shift-click ranges *from* — the last box the user actually
   * toggled. Held in a ref rather than state because it changes nothing on
   * screen, and re-rendering the whole table on every click to remember an
   * anchor is a cost with no visible return.
   */
  const anchorIndex = useRef<number | undefined>(undefined);

  /**
   * An entity that declares a parent renders as a tree: the page arranged
   * depth first, its first column indented, and a subtree hidden while its
   * record is collapsed. Collapsing is view state, so it lives here and is
   * forgotten with the table, like the shift-click anchor above.
   */
  const treeKeys = useMemo(
    () => hierarchyOf(entityConstructor),
    [entityConstructor],
  );
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const rows = useMemo(() => treeRows(items, treeKeys), [items, treeKeys]);
  const shown = shownTreeRows(rows, collapsed);
  const shownItems = shown.map(row => row.item);
  const toggleCollapsed = (key: string) =>
    setCollapsed(current => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const setSelection = (next: EntitySelection<TEntity>) =>
    onSelectionChange?.(next);

  const toggleRow = (
    index: number,
    checked: boolean,
    shiftKey: boolean,
    current: EntitySelection<TEntity>,
  ) => {
    // A shift-click extends the last toggle across the rows *on this page*, in
    // the direction the user dragged, and applies the new state to all of them.
    const from = shiftKey ? (anchorIndex.current ?? index) : index;
    const [start, end] = from <= index ? [from, index] : [index, from];

    let next = current;
    // The rows as shown: in a tree the order on screen is not the load's.
    for (const row of shownItems.slice(start, end + 1)) {
      next = toggleSelected(next, row.id, checked);
    }

    anchorIndex.current = index;
    setSelection(next);
  };

  /**
   * The header box, and it has three states rather than two: none of this
   * page's rows selected, all of them, or some. Without the third the box
   * reads as "nothing is selected" while a bulk bar sits below it saying
   * otherwise.
   */
  const pageIds = items.map(item => item.id);
  const selectedOnPage = selectionState
    ? pageIds.filter(id => isSelected(selectionState, id)).length
    : 0;
  const allOnPageSelected =
    pageIds.length > 0 && selectedOnPage === pageIds.length;
  const someOnPageSelected = selectedOnPage > 0 && !allOnPageSelected;

  const toggleAllOnPage = (
    checked: boolean,
    current: EntitySelection<TEntity>,
  ) => {
    let next = current;
    for (const id of pageIds) next = toggleSelected(next, id, checked);
    anchorIndex.current = undefined;
    setSelection(next);
  };

  /**
   * How a row names itself to a screen reader.
   *
   * The first visible column's value, because that is what the user reads the
   * row *as* — "Seleccionar Acme" rather than "Seleccionar fila 3", which tells
   * them the position they can already see and not the thing they cannot.
   */
  const rowLabel = (item: TEntity): string => {
    // The first non-identifier column **that this row actually filled in**.
    //
    // An id names a row the way "row 3" does: it repeats what the user can
    // already see. But skipping only the id is not enough — measured against
    // the seeded catalog, where `code` is the first non-id column and is empty
    // on every brand, so the label fell straight through to the id and never
    // reached `name`. A column that is blank on this row names it no better
    // than its position does, so the search continues past it.
    //
    // The id remains the last resort, because a row with nothing rendered
    // still has to announce itself.
    const named = titleColumn(item);

    return named
      ? String((item as Record<string, unknown>)[named.name])
      : String(item.id);
  };

  const selectionCell = (
    item: TEntity,
    index: number,
    // Passed in rather than closed over: this is only ever called under
    // `selectable`, which already proves the selection exists, and reading the
    // optional prop here would add a fallback arm that nothing can reach.
    current: EntitySelection<TEntity>,
  ) => (
    <Checkbox
      // Deliberately no `id`: both pivots are always in the DOM, so an id here
      // would be emitted twice per row. `aria-label` names the control instead,
      // and it names the *record* rather than the position.
      aria-label={t('table.selectRow', { record: rowLabel(item) })}
      checked={isSelected(current, item.id)}
      disabled={isBulkRunning}
      onChange={event =>
        toggleRow(
          index,
          event.currentTarget.checked,
          (event.nativeEvent as MouseEvent).shiftKey === true,
          current,
        )
      }
    />
  );

  const runTarget = (key: string, target: PendingTarget<TEntity>) => {
    if (target.kind === 'row') onUseCase?.(key, target.item);
    else onBulkUseCase?.(key, target.selection);
  };

  /**
   * Every verb on the table goes through here — the row menu, the bulk bar and
   * the toolbar — so none reaches a destructive verb around its confirmation,
   * its typed check or its Undo.
   */
  const verbs = useVerbInvoker<PendingTarget<TEntity>>({
    run: runTarget,
    busy: isBulkRunning,
    served: metadata?.useCases,
  });

  // The row a verb last ran on. Its menu trigger unmounts when the verb moved
  // the record out of every state a row verb applies to, and focus then goes
  // to that row's own link or control rather than `<body>`.
  const rowScope = useId();
  const [lastRow, setLastRow] = useState<string | undefined>(undefined);
  useFocusOnLoss(
    () =>
      lastRow === undefined ? undefined : focusableIn(`${rowScope}${lastRow}`),
    shown
      .map(({ item }) =>
        availableUseCases(rowUseCases, item)
          .map(({ key }) => key)
          .join(','),
      )
      .join(' '),
  );

  const invoke = (
    useCase: UseCaseDescriptor,
    target: PendingTarget<TEntity>,
  ) => {
    if (target.kind === 'row') {
      setLastRow(String(target.item.id));
      verbs.invoke({
        descriptor: useCase,
        target,
        object: rowLabel(target.item),
        count: 1,
      });
      return;
    }
    const count = selectionSize(target.selection);
    verbs.invoke({
      descriptor: useCase,
      target,
      object: t('confirm.selection', {
        count,
        label: entityNoun(metaEntity),
        plural: entityNoun(metaEntity, 'plural'),
      }),
      count,
      matching: target.selection.mode === 'matching',
    });
  };

  const rowMenu = (item: TEntity) =>
    hasRowMenu ? (
      <ActionBar
        surface="row-menu"
        menuLabel={t('actions.forRecord', { record: rowLabel(item) })}
        items={itemsForUseCases(
          availableUseCases(rowUseCases, item),
          translateKey,
          useCase => invoke(useCase, { kind: 'row', item }),
        )}
      />
    ) : undefined;

  /**
   * A picker's Select, then the row's verbs. Opening the record is not here:
   * it is the title's link.
   */
  const recordAction = (item: TEntity) => {
    const pick = onSelect ? (
      <Button
        type="button"
        variant="secondary"
        size="sm"
        onClick={() => onSelect(item)}
      >
        {t('table.select')}
      </Button>
    ) : undefined;

    const menu = rowMenu(item);
    if (!menu) return pick;

    return (
      <span className="flex items-center gap-2xs">
        {pick}
        {menu}
      </span>
    );
  };

  /**
   * "New" is the list's primary, and only where something can be created
   * here: the entity is not one only a flow writes (`creatable: false`), and
   * the caller may write it. A list that offered "New" to a reader who could
   * never save opened a form with no Save on it.
   */
  const mayCreate =
    newHref !== undefined &&
    metaEntity.creatable &&
    (metadata === undefined || metadata.actions.includes('write'));
  const toolbarItems: ActionBarItem[] = itemsForUseCases(
    toolbarUseCases,
    translateKey,
    useCase =>
      invoke(useCase, { kind: 'selection', selection: everythingMatching }),
    isBulkRunning,
  );
  const declaresToolbarPrimary = toolbarItems.some(
    item => item.emphasis === 'primary',
  );
  const toolbarActions: ActionBarItem[] = [
    ...(mayCreate
      ? [
          {
            key: 'new',
            label: t('table.new'),
            emphasis: declaresToolbarPrimary
              ? ('default' as const)
              : ('primary' as const),
            href: newHref,
            intent: { kind: 'new' as const },
          },
        ]
      : []),
    ...toolbarItems,
  ];

  const locale = useLocale();
  const panelId = useId();
  const keys = sortKeys(sorting, columns);
  const activeFilters = filtering?.values.length ?? 0;
  const results = t('table.results', { count: totalItems });

  /**
   * What the status region says once a filter, a sort or a page has settled —
   * debounced, and silent on the first load.
   */
  const announcement = useResultAnnouncement(
    !isLoading,
    totalItems === 0 && activeFilters > 0
      ? t('table.noResultsFiltered')
      : results,
    JSON.stringify([filtering, sorting, currentPage, pageSize]),
  );

  /** The caption: what the table holds, how many, and in what order. */
  const primaryKey = keys[0];
  const primaryColumn =
    primaryKey === undefined
      ? undefined
      : columns.find(column => column.name === primaryKey.member);
  const caption =
    primaryKey === undefined || primaryColumn === undefined
      ? t('table.caption', {
          entity: entityNoun(metaEntity, 'plural'),
          results,
        })
      : t('table.captionSorted', {
          entity: entityNoun(metaEntity, 'plural'),
          results,
          column: primaryColumn.label,
          direction: t(
            primaryKey.type === 'asc' ? 'sort.ascending' : 'sort.descending',
          ),
        });

  /**
   * A column's header: its name, and — for a sortable one — a button that
   * cycles it ascending → descending → unsorted, with Shift adding it as the
   * next key. Only the primary key carries `aria-sort`.
   */
  const headerCell = (column: EntityTableColumn<TEntity>) => {
    const label = column.header ?? column.label;
    if (!column.sortable || onSortingChange === undefined)
      return <TableHeaderCell key={column.name}>{label}</TableHeaderCell>;
    const position = keys.findIndex(key => key.member === column.name);
    const type = keys[position]?.type;
    return (
      <TableHeaderCell
        key={column.name}
        aria-sort={
          position === 0
            ? type === 'asc'
              ? 'ascending'
              : 'descending'
            : undefined
        }
      >
        <button
          type="button"
          className="inline-flex min-h-(--target-min) items-center gap-3xs rounded-sm focus-ring hover:text-content"
          onClick={event =>
            onSortingChange(
              nextHeaderSorting<TEntity>(
                keys,
                {
                  member: column.name,
                  property: queryPropertyFor(column, locale),
                },
                event.shiftKey,
              ),
            )
          }
        >
          {label}
          <span aria-hidden="true">
            {type === 'asc' ? '▲' : type === 'desc' ? '▼' : '↕'}
          </span>
          {keys.length > 1 && position >= 0 && (
            <span aria-hidden="true" className="text-step-sm">
              {position + 1}
            </span>
          )}
        </button>
      </TableHeaderCell>
    );
  };

  /** A panel toggle: its state said by `aria-expanded`, and its count shown. */
  const panelToggle = (which: Exclude<Panel, 'none'>, count: number) => (
    <Button
      type="button"
      variant={panel === which ? 'primary' : 'secondary'}
      size="sm"
      aria-expanded={panel === which}
      aria-controls={panelId}
      onClick={() => setPanel(current => (current === which ? 'none' : which))}
    >
      {t(which === 'filters' ? 'table.filters' : 'table.sorting')}
      {count > 0 && (
        // Its name stays "Filters": the chips say which filters, and a count
        // in the name would change it under the reader with every filter.
        <span
          aria-hidden="true"
          className="ms-3xs rounded-full bg-surface px-3xs text-step-sm text-content"
        >
          {count}
        </span>
      )}
    </Button>
  );

  return (
    <div className="@container/entity-table flex flex-col gap-s">
      {/*
        One announcement for the whole table, not one per layout. Both the grid
        and the card list are always in the DOM — CSS picks which is visible —
        so a live region inside each meant assistive tech was told twice that
        the table was loading. The shimmer itself is aria-hidden, so this is the
        only thing that carries the news.
      */}
      <span role="status" aria-live="polite" className="sr-only">
        {isFirstLoad ? t('table.loading') : announcement}
      </span>

      {showControls && (
        <TableToolbar
          start={
            <>
              {/* "New" and the collection-bound verbs that need no
                  selection. They sit here rather than in the bulk bar,
                  because the bulk bar only exists while rows are ticked and
                  these are always available. */}
              <LoadingBoundary isLoading={isMetadataLoading} lines={0}>
                <>
                  {toolbarActions.length > 0 && (
                    <ActionBar
                      surface="table-toolbar"
                      items={toolbarActions}
                      renderLink={renderLink}
                    />
                  )}
                </>
              </LoadingBoundary>
              {slots.toolbar}
            </>
          }
          end={
            <>
              {panelToggle('filters', activeFilters)}
              {panelToggle('sorting', keys.length)}
              <ColumnSettings
                columns={columns}
                hidden={hidden}
                onChange={setPersonalization}
              />
            </>
          }
          panelId={panelId}
          panel={
            panel === 'filters' ? (
              <FilterBuilder<TEntity>
                // Remounted when the filtering changes from outside — a chip
                // removed — so its rows show what is in effect.
                key={JSON.stringify(filtering ?? null)}
                descriptors={columns.filter(column => column.filterable)}
                facets={facets}
                value={filtering}
                onChange={(applied: FilterGroup<TEntity>) =>
                  onFilteringChange?.(applied)
                }
              />
            ) : panel === 'sorting' ? (
              <SortBuilder<TEntity>
                descriptors={columns.filter(column => column.sortable)}
                value={sorting}
                onChange={(applied: EntitySorting<TEntity>) =>
                  onSortingChange?.(applied)
                }
              />
            ) : undefined
          }
        />
      )}

      {showControls && onFilteringChange !== undefined && (
        <FilterChips<TEntity>
          descriptors={columns.filter(column => column.filterable)}
          value={filtering}
          onChange={onFilteringChange}
        />
      )}

      {/*
        The bar appears when there is something selected and something to do
        with it. It sits above the rows rather than floating over them: a fixed
        overlay covers the last row of a short page, which is the row the user
        most likely just ticked.
      */}
      {selectionState && selectionSize(selectionState) > 0 && (
        <BulkActionBar
          count={selectionSize(selectionState)}
          useCases={bulkUseCases}
          busy={isBulkRunning}
          // Offered only when this page is fully ticked and the store holds
          // more than the page — the escalation has somewhere to escalate to.
          matchingTotal={
            selectionState.mode === 'ids' &&
            allOnPageSelected &&
            totalItems > items.length
              ? totalItems
              : undefined
          }
          onSelectAllMatching={() => setSelection(everythingMatching)}
          onClear={() => setSelection(emptySelection<TEntity>())}
          onUseCase={useCase =>
            invoke(useCase, { kind: 'selection', selection: selectionState })
          }
        />
      )}

      {verbs.dialog}

      {bulkOutcomes && bulkOutcomes.length > 0 && onBulkDismiss && (
        <BulkResult
          outcomes={bulkOutcomes}
          busy={isBulkRunning}
          labelFor={id => {
            const row = items.find(item => item.id === id);
            return row ? rowLabel(row) : undefined;
          }}
          onRetryFailed={onBulkRetry}
          onDismiss={onBulkDismiss}
        />
      )}

      {/*
        Rendered once, outside both layouts, and independently of whether there
        are rows: a refetch that fails leaves the previous page on screen, and
        without this the user would read stale data as current.
      */}
      {/*
        One state for the region, outside both layouts (ADR 0028): a failed
        load with Retry — and the rows from before it marked as possibly out of
        date — or an empty answer, which says whether a filter emptied it.
      */}
      <RegionState
        plural={entityNoun(metaEntity, 'plural')}
        isLoading={isLoading}
        error={error}
        onRetry={onRetry}
        hasStaleData={items.length > 0}
        isEmpty={items.length === 0}
        isFiltered={activeFilters > 0}
        onClearFilters={
          onFilteringChange === undefined
            ? undefined
            : () =>
                onFilteringChange({
                  // Only offered under a filter, so there is one to keep the
                  // logic of.
                  operator: (filtering as FilterGroup<TEntity>).operator,
                  values: [],
                })
        }
        emptyAction={
          mayCreate
            ? renderLink({
                href: newHref as string,
                className: button({ variant: 'primary' }),
                children: t('table.new'),
                intent: { kind: 'new' },
              })
            : undefined
        }
      />

      {/* Wide viewports: a grid. */}
      <div className={pivot.grid} aria-busy={busy}>
        {/* Held to most of the viewport so the header can stick above the
            rows; the scroll padding keeps a focused row out from under it. */}
        <Table
          caption={caption}
          containerClassName="max-h-(--table-max-block) scroll-pt-12"
        >
          <TableHead>
            {slots.header ? (
              slots.header.render(visibleColumns)
            ) : (
              <tr>
                {selectable && (
                  <TableHeaderCell>
                    <Checkbox
                      aria-label={t('table.selectAllOnPage')}
                      checked={allOnPageSelected}
                      indeterminate={someOnPageSelected}
                      disabled={isBulkRunning || items.length === 0}
                      onChange={event =>
                        toggleAllOnPage(
                          event.currentTarget.checked,
                          selectionState,
                        )
                      }
                    />
                  </TableHeaderCell>
                )}
                {visibleColumns.map(headerCell)}
                {hasRowAction && (
                  <TableHeaderCell>{t('table.actions')}</TableHeaderCell>
                )}
              </tr>
            )}
          </TableHead>
          <TableBody>
            {/* Skeleton rows rather than the word "Loading", and one per column
                rather than a single full-width blob: the placeholder occupies
                the real grid, so the swap to rows shifts nothing sideways.
                `TableMessageRow` is deliberately bypassed — it is one centred
                full-span cell and cannot express the geometry. */}
            {showSkeleton &&
              (customSkeleton ? (
                <TableMessageRow colSpan={columnCount}>
                  {customSkeleton}
                </TableMessageRow>
              ) : (
                skeletonRows.map(row => (
                  <TableRow key={row}>
                    {selectable && (
                      <TableCell>
                        <Skeleton shape="line" className="w-4" />
                      </TableCell>
                    )}
                    {visibleColumns.map(column => (
                      <TableCell key={column.name}>
                        <Skeleton shape="line" className="w-full" />
                      </TableCell>
                    ))}
                    {hasRowAction && (
                      <TableCell>
                        <Skeleton shape="line" className="w-16" />
                      </TableCell>
                    )}
                  </TableRow>
                ))
              ))}
            {shown.map(({ item, depth, hasChildren }, index) =>
              slots.row ? (
                // A Fragment carries the key without wrapping the custom row in
                // an element `<tbody>` would reject.
                <Fragment key={String(item.id ?? index)}>
                  {slots.row.render(item, visibleColumns)}
                </Fragment>
              ) : (
                <TableRow
                  key={String(item.id ?? index)}
                  data-record-id={`${rowScope}${String(item.id)}`}
                >
                  {selectionState && (
                    <TableCell>
                      {selectionCell(item, index, selectionState)}
                    </TableCell>
                  )}
                  {visibleColumns.map((column, columnIndex) => (
                    <TableCell key={column.name}>
                      {treeKeys !== undefined && columnIndex === 0 ? (
                        <TreeCell
                          depth={depth}
                          hasChildren={hasChildren}
                          expanded={!collapsed.has(treeKeys.idOf(item))}
                          label={t(
                            collapsed.has(treeKeys.idOf(item))
                              ? 'table.expandRow'
                              : 'table.collapseRow',
                            { record: rowLabel(item) },
                          )}
                          onToggle={() => toggleCollapsed(treeKeys.idOf(item))}
                        >
                          {renderCell(column, item)}
                        </TreeCell>
                      ) : (
                        renderCell(column, item)
                      )}
                    </TableCell>
                  ))}
                  {hasRowAction && <TableCell>{recordAction(item)}</TableCell>}
                </TableRow>
              ),
            )}
          </TableBody>
        </Table>
      </div>

      {/* Narrow containers: the same columns pivoted into a list of cards. */}
      <div className={pivot.cards} aria-busy={busy}>
        {/* The card pivot gets card-shaped placeholders, not a bare shimmer
            block: the border, radius and padding are the geometry here. */}
        {showSkeleton &&
          (customSkeleton ?? (
            <ul role="list" className="m-0 p-0 flex list-none flex-col gap-2xs">
              {skeletonRows.map(row => (
                <li key={row}>
                  <EntityRecordCard
                    title={<Skeleton shape="line" className="w-32" />}
                    meta={visibleColumns.slice(1).map(column => ({
                      key: column.name,
                      label: column.label,
                      value: <Skeleton shape="line" className="w-24" />,
                    }))}
                  />
                </li>
              ))}
            </ul>
          ))}
        {shown.length > 0 && (
          <ul role="list" className="m-0 p-0 flex list-none flex-col gap-2xs">
            {shown.map(({ item, depth }, index) => {
              const parts = cardParts(item);
              return (
                <li
                  key={String(item.id ?? index)}
                  data-record-id={`${rowScope}${String(item.id)}`}
                  // A tree's card says how deep it sits, as its row does.
                  aria-level={treeKeys === undefined ? undefined : depth + 1}
                  style={
                    treeKeys === undefined
                      ? undefined
                      : { marginInlineStart: `${depth * 1.5}rem` }
                  }
                >
                  <EntityRecordCard
                    // The same renderers as the grid, so the two layouts agree.
                    title={
                      parts.title === undefined
                        ? rowLabel(item)
                        : renderCell(parts.title, item)
                    }
                    subtitle={
                      parts.subtitle === undefined
                        ? undefined
                        : renderCell(parts.subtitle, item)
                    }
                    badges={parts.badges.map(column => ({
                      key: column.name,
                      value: renderCell(column, item),
                    }))}
                    meta={parts.meta.map(column => ({
                      key: column.name,
                      label: column.header ?? column.label,
                      value: renderCell(column, item),
                    }))}
                    leading={
                      selectionState
                        ? selectionCell(item, index, selectionState)
                        : undefined
                    }
                    actions={recordAction(item)}
                  />
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <Pagination
        currentPage={currentPage}
        pageSize={pageSize}
        totalItems={totalItems}
        onPageChange={onPageChange}
        onPageSizeChange={onPageSizeChange}
      />

      {slots.rest}
    </div>
  );
}

/**
 * The first control in a record's row or card that the reader can see. Both
 * layouts are in the DOM and CSS shows one, so a control inside the hidden
 * one is skipped. `scoped` is the record's id under this table's own prefix,
 * so a second table on the page holding the same record is never reached.
 */
function focusableIn(scoped: string): HTMLElement | undefined {
  return [
    ...document.querySelectorAll<HTMLElement>(
      `[data-record-id="${CSS.escape(scoped)}"] :is(a[href], button)`,
    ),
  ].find(
    control =>
      // `checkVisibility` is recent; a browser without it is asked for the
      // boxes the control lays out, which a `display: none` layout has none of.
      control.checkVisibility?.() ?? control.getClientRects().length > 0,
  );
}
