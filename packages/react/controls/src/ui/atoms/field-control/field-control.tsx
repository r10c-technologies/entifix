'use client';

import type { EntityFieldDescriptor, MetaAccessorType } from '@entifix/core';

import { useEnumLabel, useLocale } from '../../../i18n/index.js';
import { Checkbox, Select, TextInput } from '../field/index.js';
import { MoneyInput } from '../money/money-input.js';
import { currencyOf } from '../money/money-math.js';

export interface FieldControlProps {
  descriptor: EntityFieldDescriptor;
  /**
   * ARIA wiring the caller owns, because only the caller knows the shape it is
   * rendered into.
   *
   * A form labels its control with a `<label for>` and needs none of this; a
   * detail grid's cell has no label of its own — the column header is the
   * label, and the cell's message is the description — so it points at both by
   * id. Passing them through here rather than duplicating the type→input map
   * in the grid is what keeps one control deciding what a `date` member looks
   * like.
   */
  'aria-labelledby'?: string;
  'aria-describedby'?: string;
  'aria-invalid'?: boolean;
  /**
   * The draft value as a string — the shape a native input round-trips. A form
   * holds its whole draft as `Record<string, string>` and reconstructs typed
   * values only at submit, so the control never sees a domain value.
   */
  value: string;
  onChange: (value: string) => void;
  id?: string;
  /**
   * The record being edited, as its draft. A money member whose currency is
   * another member (`money.currencyMember`) reads it from here.
   */
  record?: Readonly<Record<string, unknown>>;
}

/** Native input type for the text-like controls; text is the default. */
const INPUT_TYPE: Partial<Record<MetaAccessorType, string>> = {
  number: 'number',
  date: 'date',
};

/**
 * The edit-mode inverse of {@link CellValue}: it turns one metadata descriptor
 * into the input that edits it. Centralizing the type→control choice is what
 * lets a form stay generic, the same way `CellValue` keeps a table generic.
 *
 * A relation (`link`/`linkCollection`) is rendered read-only here, deliberately:
 * editing one needs a picker that can search and page the target, which is a
 * different control with different dependencies. So this atom stays a pure
 * type→input map and a relation never falls back to a broken text box.
 *
 * For a to-one `link` that is only half the story — `EntityForm` wires the
 * picker in one level up from its `linkSources`, so the member does get an
 * editor, just not from here. A `linkCollection` has no editor anywhere yet
 * (#26), and read-only is all it gets. A `composition` is the same: its rows
 * need a detail grid, and a text box holding `[object Object]` would be
 * strictly worse than an honest disabled field.
 *
 * A `scalarCollection` is the exception among the collections and falls through
 * to the plain text input on purpose: a `string[]` has a lossless comma form,
 * so the draft it round-trips through *is* editable text. Splitting on the
 * comma is `reconstructEntity`'s half of that same contract.
 */
export function FieldControl({
  descriptor,
  value,
  onChange,
  id,
  record,
  ...aria
}: FieldControlProps) {
  const enumLabel = useEnumLabel();
  const locale = useLocale();
  const disabled =
    descriptor.readonly ||
    descriptor.type === 'link' ||
    descriptor.type === 'linkCollection' ||
    descriptor.type === 'composition';

  if (descriptor.type === 'boolean') {
    return (
      <Checkbox
        id={id}
        {...aria}
        label={descriptor.label}
        checked={value === 'true'}
        disabled={disabled}
        onChange={event => onChange(String(event.currentTarget.checked))}
      />
    );
  }

  if (descriptor.type === 'enum') {
    return (
      <Select
        id={id}
        {...aria}
        value={value}
        disabled={disabled}
        onChange={event => onChange(event.currentTarget.value)}
      >
        <option value="">—</option>
        {(descriptor.enumValues ?? []).map(option => (
          <option key={option} value={option}>
            {enumLabel(descriptor, option)}
          </option>
        ))}
      </Select>
    );
  }

  // An amount is edited in major units, in the reader's decimal separator,
  // and written back in the unit it is stored in. Without a currency to know
  // the minor units by, it stays a plain number field.
  const currency =
    descriptor.money === undefined
      ? undefined
      : currencyOf(descriptor.money, record);
  if (descriptor.money !== undefined && currency !== undefined) {
    return (
      <MoneyInput
        id={id}
        {...aria}
        value={value}
        currency={currency}
        unit={descriptor.money.unit}
        locale={locale}
        disabled={disabled}
        onChange={onChange}
      />
    );
  }

  return (
    <TextInput
      id={id}
      {...aria}
      type={INPUT_TYPE[descriptor.type] ?? 'text'}
      value={value}
      disabled={disabled}
      onChange={event => onChange(event.currentTarget.value)}
    />
  );
}
