import type { Entity, MetaAccessorType } from '@entifix/core';

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

/**
 * The container width, in `rem`, at which a table's visible columns fit side
 * by side: the sum of their widths and of the selection and actions columns —
 * or a declared breakpoint's, which overrides it.
 */
export function pivotWidth<TEntity extends Entity>(
  columns: readonly EntityTableColumn<TEntity>[],
  extra: number,
  breakpoint?: EntityTablePivotBreakpoint,
): number {
  if (breakpoint !== undefined) return BREAKPOINT_WIDTH[breakpoint];
  return columns.reduce(
    (sum, column) =>
      sum +
      (column.minWidth ?? TYPE_MIN_WIDTH[column.type] ?? DEFAULT_MIN_WIDTH),
    extra,
  );
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
