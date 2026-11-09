'use client';

import {
  type Entity,
  type EntityFieldDescriptor,
  type FilterGroup,
  findQueriedDescriptor,
} from '@entifix/core';

import { useEnumLabel, useT } from '../../../i18n/index.js';
import { Button } from '../../atoms/button/index.js';
import {
  type EntityFilterOperator,
  operatorLabelKey,
} from '../filter-builder/filter-operators.js';

export interface FilterChipsProps<TEntity extends Entity> {
  /** Filterable members, to name each filter by its column. */
  descriptors: readonly EntityFieldDescriptor[];
  /** The filtering in effect. */
  value?: FilterGroup<TEntity>;
  onChange: (filtering: FilterGroup<TEntity>) => void;
}

interface AppliedFilter {
  readonly property: unknown;
  readonly operator: EntityFilterOperator;
  readonly value?: unknown;
  readonly values?: readonly unknown[];
  readonly start?: unknown;
  readonly end?: unknown;
}

/**
 * The filters in effect, one removable chip each, and Clear all — so what
 * narrowed the list is visible without opening the builder, and each can be
 * dropped in one step. A nested group, which the builder cannot express, has
 * no chip; Clear all still removes it.
 */
export function FilterChips<TEntity extends Entity>({
  descriptors,
  value,
  onChange,
}: FilterChipsProps<TEntity>) {
  const t = useT();
  const enumLabel = useEnumLabel();
  if (value === undefined || value.values.length === 0) return null;

  const text = (descriptor: EntityFieldDescriptor | undefined, raw: unknown) =>
    raw instanceof Date
      ? raw.toISOString().slice(0, 10)
      : typeof raw === 'boolean'
        ? t(raw ? 'value.yes' : 'value.no')
        : descriptor?.type === 'enum'
          ? enumLabel(descriptor, String(raw))
          : String(raw);

  const chips = value.values.flatMap((node, index) => {
    if (!('property' in node)) return [];
    const filter = node as AppliedFilter;
    const descriptor = findQueriedDescriptor(
      descriptors,
      String(filter.property),
    );
    const operand =
      filter.values !== undefined
        ? filter.values.map(entry => text(descriptor, entry)).join(', ')
        : filter.start !== undefined
          ? `${text(descriptor, filter.start)} – ${text(descriptor, filter.end)}`
          : filter.value === undefined
            ? ''
            : text(descriptor, filter.value);
    const label = [
      descriptor?.label ?? String(filter.property),
      t(operatorLabelKey(filter.operator)),
      operand,
    ]
      .filter(part => part !== '')
      .join(' ');
    return [{ index, label }];
  });

  return (
    <div
      role="group"
      aria-label={t('filter.applied')}
      className="flex flex-wrap items-center gap-3xs"
    >
      {chips.map(chip => (
        <span
          key={chip.index}
          className="inline-flex items-center gap-3xs rounded-full border border-border bg-surface ps-xs text-step-sm text-content"
        >
          {chip.label}
          <Button
            type="button"
            variant="ghost"
            size="sm"
            aria-label={t('filter.removeChip', { filter: chip.label })}
            onClick={() =>
              onChange({
                operator: value.operator,
                values: value.values.filter((_, at) => at !== chip.index),
              })
            }
          >
            ✕
          </Button>
        </span>
      ))}
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={() => onChange({ operator: value.operator, values: [] })}
      >
        {t('filter.clearAll')}
      </Button>
    </div>
  );
}
