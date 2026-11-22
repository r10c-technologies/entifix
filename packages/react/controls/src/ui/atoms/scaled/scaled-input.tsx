'use client';

import { formatScaled, parseScaled } from '@entifix/core';
import { useEffect, useId, useState } from 'react';

import { useT } from '../../../i18n/index.js';
import {
  NumberInput,
  type NumberInputProps,
} from '../number-input/number-input.js';
import { typedText, unparsedDraft } from '../number-input/unparsed.js';

export interface ScaledInputProps extends Omit<
  NumberInputProps,
  'value' | 'onChange' | 'inputMode'
> {
  /** The stored integer, as a draft string (`'3500'`), or `''` for none. */
  value: string;
  /** Called with the stored integer as a draft string. */
  onChange: (value: string) => void;
  /** `undefined` while the record names no unit: the field then waits. */
  scale: number | undefined;
  /** The unit as the reader names it, shown after the field. */
  unit?: string;
  locale: string;
}

/**
 * Edits a scaled integer as the decimal it stands for and writes back the
 * integer. What was typed is kept as typed and is never rounded: text that is
 * no number in this scale reaches the draft as itself, for validation to
 * refuse.
 *
 * When the unit changes under it, a number the person typed keeps its meaning
 * — `3` stays three, metres or pieces — and a stored one is only shown again
 * in the new scale.
 */
export function ScaledInput({
  value,
  onChange,
  scale,
  unit,
  locale,
  disabled,
  'aria-describedby': describedBy,
  ...props
}: ScaledInputProps) {
  const t = useT();
  const unitId = useId();
  const display = (stored: string) =>
    scale === undefined || !Number.isSafeInteger(Number(stored || Number.NaN))
      ? typedText(stored)
      : formatScaled(Number(stored), scale, locale, { grouping: false });
  const storedOf = (typed: string, at: number) => {
    const parsed = parseScaled(typed, at, locale);
    return parsed === undefined ? unparsedDraft(typed) : String(parsed);
  };

  const [text, setText] = useState(() => display(value));
  const [emitted, setEmitted] = useState(value);
  const [typed, setTyped] = useState(false);
  const [readAt, setReadAt] = useState(scale);

  useEffect(() => {
    if (value !== emitted) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- an outside write (a reset, a load) replaces what was typed
      setText(display(value));
      setEmitted(value);
      setTyped(false);
      setReadAt(scale);
      return;
    }
    if (scale === readAt) return;
    setReadAt(scale);
    if (!typed) {
      setText(display(value));
      return;
    }
    const next =
      scale === undefined ? unparsedDraft(text) : storedOf(text, scale);
    setEmitted(next);
    if (next !== value) onChange(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- it answers an outside value or a changed scale, never its own typing
  }, [value, scale, locale]);

  const waiting = scale === undefined;
  const hint = waiting ? t('quantity.needsUnit') : unit;

  return (
    <span className="inline-flex items-center gap-2xs">
      <NumberInput
        {...props}
        disabled={disabled === true || waiting}
        aria-describedby={
          [describedBy, hint === undefined ? undefined : unitId]
            .filter(Boolean)
            .join(' ') || undefined
        }
        inputMode={scale === 0 ? 'numeric' : 'decimal'}
        value={text}
        onChange={event => {
          const next = event.currentTarget.value;
          setText(next);
          setTyped(true);
          // Disabled while it waits, so there is always a scale to read in.
          const stored = storedOf(next, scale as number);
          setEmitted(stored);
          onChange(stored);
        }}
      />
      {hint !== undefined && (
        <span id={unitId} className="text-step-sm text-content-muted">
          {hint}
        </span>
      )}
    </span>
  );
}
