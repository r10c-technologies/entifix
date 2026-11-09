import type {
  Entity,
  EntityFieldDescriptor,
  EntitySorting,
  EntitySortType,
} from '@entifix/core';
import { findQueriedDescriptor } from '@entifix/core';

/** One key of a sorting, by the member it sorts, in precedence order. */
export interface SortKey {
  /** The member's accessor name — what a column is addressed by. */
  readonly member: string;
  /** The wire key it sorts by: a locale path for a localized member. */
  readonly property: string;
  readonly type: EntitySortType;
}

/** A sorting's keys in precedence order, each resolved to its member. */
export function sortKeys<TEntity extends Entity>(
  sorting: EntitySorting<TEntity> | undefined,
  descriptors: readonly EntityFieldDescriptor[],
): SortKey[] {
  if (sorting === undefined) return [];
  return Object.keys(sorting)
    .map(Number)
    .sort((left, right) => left - right)
    .flatMap(priority => {
      const entry = sorting[priority] as NonNullable<
        EntitySorting<TEntity>[number]
      >;
      const property = String(entry.property);
      const descriptor = findQueriedDescriptor(descriptors, property);
      return descriptor === undefined
        ? []
        : [{ member: descriptor.name, property, type: entry.type }];
    });
}

const NEXT: Record<'none' | EntitySortType, EntitySortType | undefined> = {
  none: 'asc',
  asc: 'desc',
  desc: undefined,
};

/**
 * The sorting after a header click: the member cycles ascending → descending →
 * unsorted. A plain click makes it the only key; with Shift it is added as the
 * next key, or cycled where it already stands, and the others are kept.
 */
export function nextHeaderSorting<TEntity extends Entity>(
  keys: readonly SortKey[],
  clicked: Omit<SortKey, 'type'>,
  additive: boolean,
): EntitySorting<TEntity> {
  const position = keys.findIndex(key => key.member === clicked.member);
  // A plain click on a secondary key starts it over as the primary one.
  const from =
    position === -1 || (!additive && position > 0)
      ? 'none'
      : (keys[position] as SortKey).type;
  const type = NEXT[from];
  const cycled = type === undefined ? [] : [{ ...clicked, type }];

  const next = !additive
    ? cycled
    : position === -1
      ? [...keys, ...cycled]
      : [...keys.slice(0, position), ...cycled, ...keys.slice(position + 1)];

  return Object.fromEntries(
    next.map((key, index) => [
      index,
      { property: key.property as keyof TEntity, type: key.type },
    ]),
  ) as EntitySorting<TEntity>;
}
