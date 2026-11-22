'use client';

import { formatScaled, parseScaled, scaledToDecimal } from '@entifix/core';
import { type KeyboardEvent, useEffect, useId, useState } from 'react';

import { useLocale, useT } from '../../../i18n/index.js';
import { cn } from '../../utils/cn.js';
import type { QuantityInputProps } from './quantity-input.js';
import { STEP_BUTTON } from './step-button.js';

/**
 * `QuantityInput` given a `scale`: every number across its props is the stored
 * integer, and the field shows and takes the decimal.
 *
 * ⚠️ It never alters what was typed — no clamp, no rounding, no snap to the
 * step: selling 3 to someone who typed 3,5 is the defect this mode exists to
 * prevent. An entry outside the rules is marked invalid and still reported,
 * and text that is no number is reported as `NaN`, so a caller never keeps
 * the previous quantity under a field that shows another. Only − and +, which
 * ask for a change, land on the step and inside the bounds.
 */
export function ScaledQuantityInput({
  label,
  value: controlled,
  defaultValue,
  onChange,
  min = 0,
  max,
  step,
  scale,
  unit,
  invalid = false,
  disabled = false,
  id,
  name,
  className,
  'aria-describedby': describedBy,
}: QuantityInputProps & { scale: number }) {
  const t = useT();
  const locale = useLocale();
  const unitId = useId();
  const editable = (stored: number) =>
    Number.isSafeInteger(stored)
      ? formatScaled(stored, scale, locale, { grouping: false })
      : '';

  const [own, setOwn] = useState(defaultValue ?? min);
  const value = controlled ?? own;
  const [text, setText] = useState(() => editable(value));
  const [emitted, setEmitted] = useState(value);

  useEffect(() => {
    if (Object.is(value, emitted)) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the value moved from outside (a reset, a load)
    setText(editable(value));
    setEmitted(value);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- it answers an outside value, never its own typing
  }, [value]);

  const report = (next: number) => {
    setEmitted(next);
    setOwn(next);
    if (!Object.is(next, value)) onChange?.(next);
  };
  const jump = (next: number) => {
    const bounded = Math.min(
      max ?? Number.MAX_SAFE_INTEGER,
      Math.max(min, next),
    );
    setText(editable(bounded));
    report(bounded);
  };

  const readable = Number.isSafeInteger(value);
  const by = step ?? 10 ** scale;
  const more = () => jump(readable ? (Math.floor(value / by) + 1) * by : min);
  const less = () => jump(readable ? (Math.ceil(value / by) - 1) * by : min);
  const refused =
    !readable ||
    value < min ||
    (max !== undefined && value > max) ||
    (step !== undefined && value % step !== 0);

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    const move = {
      ArrowUp: more,
      ArrowDown: less,
      Home: () => jump(min),
      End: max === undefined ? undefined : () => jump(max),
    }[event.key];
    if (move === undefined) return;
    event.preventDefault();
    move();
  };

  const decimal = (stored: number) => Number(scaledToDecimal(stored, scale));

  return (
    <span className={cn('inline-flex items-center gap-3xs', className)}>
      <button
        type="button"
        tabIndex={-1}
        aria-label={t('quantity.decrease', { label })}
        disabled={disabled || (readable && value <= min)}
        onClick={less}
        className={STEP_BUTTON}
      >
        <span aria-hidden="true">−</span>
      </button>
      <input
        id={id}
        name={name}
        type="text"
        role="spinbutton"
        inputMode={scale === 0 ? 'numeric' : 'decimal'}
        aria-label={label}
        aria-valuenow={readable ? decimal(value) : undefined}
        aria-valuetext={
          readable
            ? [formatScaled(value, scale, locale), unit]
                .filter(Boolean)
                .join(' ')
            : text || undefined
        }
        aria-valuemin={decimal(min)}
        aria-valuemax={max === undefined ? undefined : decimal(max)}
        aria-invalid={invalid || refused || undefined}
        aria-describedby={
          [describedBy, unit === undefined ? undefined : unitId]
            .filter(Boolean)
            .join(' ') || undefined
        }
        disabled={disabled}
        value={text}
        onChange={event => {
          const next = event.currentTarget.value;
          setText(next);
          report(parseScaled(next, scale, locale) ?? Number.NaN);
        }}
        onKeyDown={onKeyDown}
        className="w-24 min-h-(--target-min) rounded-lg border border-border-control bg-surface-elevated px-2xs py-3xs text-center text-step-sm text-content tabular-nums focus-ring disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-danger"
      />
      {unit !== undefined && (
        <span id={unitId} className="text-step-sm text-content-muted">
          {unit}
        </span>
      )}
      <button
        type="button"
        tabIndex={-1}
        aria-label={t('quantity.increase', { label })}
        disabled={disabled || (max !== undefined && value >= max)}
        onClick={more}
        className={STEP_BUTTON}
      >
        <span aria-hidden="true">+</span>
      </button>
    </span>
  );
}
