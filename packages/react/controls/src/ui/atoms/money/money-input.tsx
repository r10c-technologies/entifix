'use client';

import { parseScaled, scaledToDecimal } from '@entifix/core';
import { useEffect, useState } from 'react';

import {
  NumberInput,
  type NumberInputProps,
} from '../number-input/number-input.js';
import { typedText, unparsedDraft } from '../number-input/unparsed.js';
import { fractionDigits, type MoneyUnit, toMajorUnits } from './money-math.js';

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

/**
 * Edits an amount in major units — what a person means by a price — and writes
 * back the stored unit. What was typed is kept as typed (a trailing `64,` is
 * not reformatted under the cursor), and the field follows the stored value
 * only when it changes from outside.
 *
 * `1,000` is a thousand in any locale, since no two-decimal currency has
 * three; text with more decimals than the currency holds is refused by
 * validation rather than rounded (`parseScaled`).
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
      ? typedText(stored)
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
          const minor = parseScaled(next, digits, locale);
          const stored =
            minor === undefined
              ? unparsedDraft(next)
              : unit === 'minor'
                ? String(minor)
                : scaledToDecimal(minor, digits);
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
