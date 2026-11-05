'use client';

import { useEffect, useState } from 'react';

import {
  NumberInput,
  type NumberInputProps,
} from '../number-input/number-input.js';
import {
  fractionDigits,
  fromMajorUnits,
  type MoneyUnit,
  toMajorUnits,
} from './money-math.js';

export interface MoneyInputProps extends Omit<
  NumberInputProps,
  'value' | 'onChange' | 'inputMode'
> {
  /** The stored amount, as a draft string (`'6499'`), or `''` for none. */
  value: string;
  /** Called with the stored amount as a draft string. */
  onChange: (value: string) => void;
  currency: string;
  unit: MoneyUnit;
  locale: string;
}

const parseMajor = (text: string): number | undefined => {
  // Accept either decimal separator: the last `,` or `.` is the decimal one.
  const normalised = text.trim().replace(/[\s']/g, '');
  if (normalised === '') return undefined;
  const last = Math.max(
    normalised.lastIndexOf(','),
    normalised.lastIndexOf('.'),
  );
  const plain =
    last === -1
      ? normalised
      : `${normalised.slice(0, last).replace(/[.,]/g, '')}.${normalised.slice(last + 1)}`;
  const major = Number(plain);
  return Number.isFinite(major) ? major : undefined;
};

/**
 * Edits an amount in major units — what a person means by a price — and writes
 * back the stored unit. What was typed is kept as typed (a trailing `64,` is
 * not reformatted under the cursor), and the field follows the stored value
 * only when it changes from outside.
 */
export function MoneyInput({
  value,
  onChange,
  currency,
  unit,
  locale,
  ...props
}: MoneyInputProps) {
  const digits = fractionDigits(currency);
  const display = (stored: string) =>
    stored === '' || !Number.isFinite(Number(stored))
      ? stored
      : new Intl.NumberFormat(locale, {
          minimumFractionDigits: digits,
          maximumFractionDigits: digits,
          useGrouping: false,
        }).format(toMajorUnits(Number(stored), currency, unit));

  const [text, setText] = useState(() => display(value));
  const [emitted, setEmitted] = useState(value);

  useEffect(() => {
    if (value === emitted) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- an outside write (a reset, a load) replaces what was typed
    setText(display(value));
    setEmitted(value);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `display` is derived from props already listed
  }, [value, emitted, currency, unit, locale]);

  return (
    <span className="inline-flex items-center gap-2xs">
      <NumberInput
        {...props}
        inputMode={digits === 0 ? 'numeric' : 'decimal'}
        value={text}
        onChange={event => {
          const next = event.currentTarget.value;
          setText(next);
          const major = parseMajor(next);
          const stored =
            major === undefined
              ? next.trim() === ''
                ? ''
                : next
              : String(fromMajorUnits(major, currency, unit));
          setEmitted(stored);
          onChange(stored);
        }}
      />
      <span className="text-step-sm text-content-muted" aria-hidden="true">
        {currency}
      </span>
    </span>
  );
}
