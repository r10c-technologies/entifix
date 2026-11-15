import type { CardRole, Entity, MetaAccessorType } from '@entifix/core';

import type {
  EntityTableColumn,
  EntityTablePivotBreakpoint,
} from './entity-table.types.js';

/**
 * The narrowest a column of each type reads at, in `rem`, when its member
 * declares no `minWidth`.
 */
export const TYPE_MIN_WIDTH: Partial<Record<MetaAccessorType, number>> = {
  id: 6,
  string: 10,
  number: 6,
  boolean: 4,
  date: 8,
  enum: 8,
  link: 10,
};

/** Any other type — a collection, a composition. */
const DEFAULT_MIN_WIDTH = 8;
/** The selection column, and the row's actions. */
export const SELECTION_WIDTH = 3;
export const ACTIONS_WIDTH = 5;

/** A breakpoint's width, now read against the table's own container. */
const BREAKPOINT_WIDTH: Record<EntityTablePivotBreakpoint, number> = {
  sm: 40,
  md: 48,
  lg: 64,
};

/**
 * The container widths a table can switch at — Tailwind's named container
 * sizes, in `rem` — each with its classes written out in full: Tailwind sees
 * only a class it can read in the source, never one built at runtime. The grid
 * is `display: none` below the width and the cards at and above it.
 */
const STEPS: readonly (readonly [number, string, string])[] = [
  [20, 'hidden @xs/entity-table:block', '@xs/entity-table:hidden'],
  [24, 'hidden @sm/entity-table:block', '@sm/entity-table:hidden'],
  [28, 'hidden @md/entity-table:block', '@md/entity-table:hidden'],
  [32, 'hidden @lg/entity-table:block', '@lg/entity-table:hidden'],
  [36, 'hidden @xl/entity-table:block', '@xl/entity-table:hidden'],
  [42, 'hidden @2xl/entity-table:block', '@2xl/entity-table:hidden'],
  [48, 'hidden @3xl/entity-table:block', '@3xl/entity-table:hidden'],
  [56, 'hidden @4xl/entity-table:block', '@4xl/entity-table:hidden'],
  [64, 'hidden @5xl/entity-table:block', '@5xl/entity-table:hidden'],
  [72, 'hidden @6xl/entity-table:block', '@6xl/entity-table:hidden'],
  [80, 'hidden @7xl/entity-table:block', '@7xl/entity-table:hidden'],
];

/** A column's narrowest reading width: declared, its type's, or the default. */
export const columnWidth = <TEntity extends Entity>(
  column: EntityTableColumn<TEntity>,
): number =>
  column.minWidth ?? TYPE_MIN_WIDTH[column.type] ?? DEFAULT_MIN_WIDTH;

/** How many `meta` or `subtitle` columns a row needs beside its title to be read. */
export const ESSENTIAL_META = 2;

/** What {@link pivotWidths} weighs a table's columns by. */
export interface PivotColumns<TEntity extends Entity> {
  readonly columns: readonly EntityTableColumn<TEntity>[];
  /** The column a row reads as, kept in view while the grid scrolls. */
  readonly title: EntityTableColumn<TEntity> | undefined;
  readonly roleOf: (column: EntityTableColumn<TEntity>) => CardRole;
  /** The selection and actions columns. */
  readonly extra: number;
  readonly breakpoint?: EntityTablePivotBreakpoint;
}

/**
 * Two container widths, in `rem`
 * ([ADR 0027](../../../../../../../docs/adr/0027-the-table-evolves-natively.md)):
 *
 * - `essential` — what a row needs to be read as a row: its title, its
 *   badges, up to {@link ESSENTIAL_META} `meta` or `subtitle` columns, and the
 *   selection and actions columns. The grid shows at and above it; cards
 *   only below, where a row really cannot be read across.
 * - `full` — every visible column side by side. Between the two the grid
 *   scrolls sideways, its title column held in view.
 *
 * Summing every column made an eleven-column list need 97rem, so a window with
 * its sidebar open always got nine labelled lines per record. A declared
 * breakpoint still overrides both.
 */
export function pivotWidths<TEntity extends Entity>({
  columns,
  title,
  roleOf,
  extra,
  breakpoint,
}: PivotColumns<TEntity>): { essential: number; full: number } {
  const full = columns.reduce(
    (sum, column) => sum + columnWidth(column),
    extra,
  );
  if (breakpoint !== undefined) {
    const width = BREAKPOINT_WIDTH[breakpoint];
    return { essential: width, full: width };
  }
  const rest = columns.filter(column => column !== title);
  const essentials = [
    ...(title === undefined ? [] : [title]),
    ...rest.filter(column => roleOf(column) === 'badge'),
    ...rest
      .filter(column => {
        const role = roleOf(column);
        return role === 'meta' || role === 'subtitle';
      })
      .slice(0, ESSENTIAL_META),
  ];
  return {
    essential: essentials.reduce(
      (sum, column) => sum + columnWidth(column),
      extra,
    ),
    full,
  };
}

/**
 * The classes that show the grid at and above `width`, and the cards below:
 * the first named size that holds it, or the widest.
 */
export function pivotClasses(width: number): { grid: string; cards: string } {
  const [, grid, cards] = (STEPS.find(([size]) => size >= width) ??
    STEPS[STEPS.length - 1]) as readonly [number, string, string];
  return { grid, cards };
}
