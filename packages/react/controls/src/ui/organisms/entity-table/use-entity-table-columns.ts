'use client';

import {
  describeEntityColumns,
  type Entity,
  type EntityConstructor,
} from '@entifix/core';
import { useMemo } from 'react';

import { useLocalizedDescriptors } from '../../../i18n/index.js';
import { useUiPreference } from '../../../preferences/index.js';
import type { ColumnPersonalization } from '../../molecules/column-settings/index.js';
import type { EntityTableColumn } from './entity-table.types.js';
import type { EntityColumnProps } from './entity-table-slots.js';

const EMPTY_PERSONALIZATION: ColumnPersonalization = {};
const NONE_WITHHELD: readonly string[] = [];

/**
 * Applies `<EntityColumn>` overrides on top of the metadata descriptors, and
 * appends a virtual column for any slot naming a member the entity does not
 * have (a computed column).
 */
function mergeSlots<TEntity extends Entity>(
  descriptors: Array<EntityTableColumn<TEntity>>,
  slotColumns: Array<EntityColumnProps<TEntity>>,
): Array<EntityTableColumn<TEntity>> {
  const merged = descriptors.map(descriptor => {
    const slot = slotColumns.find(entry => entry.field === descriptor.name);
    if (!slot) return descriptor;
    const { field: _field, ...overrides } = slot;
    return {
      ...descriptor,
      ...Object.fromEntries(
        Object.entries(overrides).filter(([, value]) => value !== undefined),
      ),
    } as EntityTableColumn<TEntity>;
  });

  const virtual = slotColumns
    .filter(slot => !descriptors.some(entry => entry.name === slot.field))
    .map<EntityTableColumn<TEntity>>((slot, index) => ({
      name: slot.field,
      key: slot.field,
      label: slot.label ?? slot.field,
      type: slot.type ?? 'string',
      sortable: slot.sortable ?? false,
      filterable: slot.filterable ?? false,
      order: slot.order ?? descriptors.length + index,
      readonly: false,
      required: false,
      linkLabelProperty: 'name',
      linkSearchProperty: 'name',
      linkSerialization: 'id',
      // A slot-only column has no accessor, so there is nothing for a copy to
      // reset — the value is computed from members that are cloned themselves.
      resetOnClone: false,
      ...(slot.minWidth === undefined ? {} : { minWidth: slot.minWidth }),
      ...(slot.money === undefined ? {} : { money: slot.money }),
      header: slot.header,
      render: slot.render,
      virtual: true,
    }));

  return [...merged, ...virtual].sort(
    (left, right) => left.order - right.order,
  );
}

/**
 * Reorders columns per the stored personalization. Names the user never saw
 * (added to the entity after the layout was saved) keep their default position
 * at the end instead of vanishing, and stale names in the stored order are
 * dropped — so a saved layout degrades rather than breaks.
 */
function applyOrder<TEntity extends Entity>(
  columns: Array<EntityTableColumn<TEntity>>,
  order: string[] | undefined,
): Array<EntityTableColumn<TEntity>> {
  if (!order || order.length === 0) return columns;

  const ranked = order
    .map(name => columns.find(column => column.name === name))
    .filter((column): column is EntityTableColumn<TEntity> => !!column);
  const remaining = columns.filter(column => !order.includes(column.name));

  return [...ranked, ...remaining];
}

/**
 * Drops the columns the host withholds from this reader. Not a hidden column
 * the reader can bring back: it is gone from the settings, the filters, the
 * sort choices and the cards. A name that is no column throws, because a
 * withheld column that is still on screen is the failure nobody would notice.
 */
function withhold<TEntity extends Entity>(
  columns: Array<EntityTableColumn<TEntity>>,
  withheld: readonly string[],
): Array<EntityTableColumn<TEntity>> {
  for (const name of withheld) {
    if (!columns.some(column => column.name === name)) {
      throw new Error(
        `EntityTable was asked to hide "${name}", which is not one of its columns. ` +
          'Name a member the entity declares, or a column a slot adds.',
      );
    }
  }
  return columns.filter(column => !withheld.includes(column.name));
}

/**
 * Whether a column is the record's own key — the entity's `id`, not a
 * reference to another record's.
 */
function isOwnKey<TEntity extends Entity>(
  column: EntityTableColumn<TEntity>,
): boolean {
  return column.type === 'id' && column.references === undefined;
}

/**
 * The whole column pipeline as a pure function — metadata descriptors, then
 * slot overrides, then what the host withholds and the record's own key
 * (unless `showKey`), then the user's stored layout.
 * Kept separate from the hook so the resolution rules can be reasoned about
 * (and tested) without React.
 */
export function resolveEntityTableColumns<TEntity extends Entity>(
  described: Array<EntityTableColumn<TEntity>>,
  slotColumns: Array<EntityColumnProps<TEntity>>,
  personalization: ColumnPersonalization,
  withheld: readonly string[] = NONE_WITHHELD,
  showKey = false,
): {
  columns: Array<EntityTableColumn<TEntity>>;
  visibleColumns: Array<EntityTableColumn<TEntity>>;
  hidden: string[];
} {
  const kept = withhold(mergeSlots(described, slotColumns), withheld);
  const columns = applyOrder(
    showKey ? kept : kept.filter(column => !isOwnKey(column)),
    personalization.order,
  );
  const hidden = personalization.hidden ?? [];

  return {
    columns,
    visibleColumns: columns.filter(column => !hidden.includes(column.name)),
    hidden,
  };
}

export interface UseEntityTableColumnsResult<TEntity extends Entity> {
  /** Every column, in the user's order — what the settings popover lists. */
  columns: Array<EntityTableColumn<TEntity>>;
  /** The subset actually rendered. */
  visibleColumns: Array<EntityTableColumn<TEntity>>;
  hidden: string[];
  personalization: ColumnPersonalization;
  setPersonalization: (next: ColumnPersonalization) => void;
}

/**
 * Resolves the columns a table renders: entity metadata, then slot overrides,
 * then the user's persisted layout.
 */
export function useEntityTableColumns<TEntity extends Entity>(
  entityConstructor: EntityConstructor<TEntity>,
  slotColumns: Array<EntityColumnProps<TEntity>>,
  sample: TEntity | undefined,
  preferenceKey: string,
  withheld: readonly string[] = NONE_WITHHELD,
  showKey = false,
): UseEntityTableColumnsResult<TEntity> {
  const { value: personalization, setValue: setPersonalization } =
    useUiPreference<ColumnPersonalization>(
      preferenceKey,
      EMPTY_PERSONALIZATION,
    );

  const metadata = useMemo(
    () =>
      describeEntityColumns(entityConstructor, sample).filter(
        descriptor => descriptor.presentation !== 'none',
      ) as Array<EntityTableColumn<TEntity>>,
    [entityConstructor, sample],
  );

  // Before slots merge, so an `<EntityColumn label>` override still wins over
  // the entity's own translated label.
  const described = useLocalizedDescriptors(metadata);

  // Not memoized: `slotColumns` is rebuilt from `children` on every render, so
  // any dependency list would miss every time. The work is a few array passes
  // over a handful of columns — cheaper than the comparison would be.
  const { columns, visibleColumns, hidden } = resolveEntityTableColumns(
    described,
    slotColumns,
    personalization,
    withheld,
    showKey,
  );

  return {
    columns,
    visibleColumns,
    hidden,
    personalization,
    setPersonalization,
  };
}
