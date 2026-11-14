import { type CardRole, type Entity } from '@entifix/core';

import type { EntityTableColumn } from './entity-table.types.js';

/**
 * Each column's part on a record's card: its declared `card` role, or the
 * default — an id is hidden, the first undeclared enum is the badge, and the
 * rest are meta. Shared by the cards and by the pivot, which counts a card's
 * essentials to decide when the grid no longer fits.
 */
export function cardRoles<TEntity extends Entity>(
  columns: readonly EntityTableColumn<TEntity>[],
): (column: EntityTableColumn<TEntity>) => CardRole {
  const firstEnum = columns.find(
    column => column.card === undefined && column.type === 'enum',
  );
  return column =>
    column.card ??
    (column.type === 'id' ? 'hidden' : column === firstEnum ? 'badge' : 'meta');
}
