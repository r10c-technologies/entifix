'use client';

import { type KeyboardEvent, useEffect, useState } from 'react';

import { useT } from '../../../i18n/index.js';
import { cn } from '../../utils/cn.js';

export interface QuantityInputProps {
  /** What is being counted; names the spinbutton and both of its buttons. */
  label: string;
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  disabled?: boolean;
  id?: string;
  className?: string;
}

const STEP_BUTTON =
  'flex min-h-(--target-min) min-w-(--target-min) shrink-0 items-center justify-center rounded-md border border-border-control bg-surface-elevated text-content hover:bg-surface disabled:cursor-not-allowed disabled:opacity-50';

/**
 * A count, on the WAI-ARIA spinbutton pattern: Up and Down step it, Home and
 * End jump to its bounds, and what is typed is committed on Enter or on
 * leaving the field, clamped to the bounds. The − and + beside it are named
 * "Decrease {label}" and "Increase {label}" and sit at `--target-min`; they are
 * out of the Tab order, as the pattern has them, because the arrow keys
 * already do what they do.
 */
export function QuantityInput({
  label,
  value,
  onChange,
  min = 0,
  max,
  step = 1,
  disabled = false,
  id,
  className,
}: QuantityInputProps) {
  const t = useT();
  const [text, setText] = useState(String(value));

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the value moved from outside (a step, a reset)
    setText(String(value));
  }, [value]);

  const clamp = (next: number) =>
    Math.min(max ?? Number.POSITIVE_INFINITY, Math.max(min, next));
  const set = (next: number) => {
    const clamped = clamp(next);
    setText(String(clamped));
    if (clamped !== value) onChange(clamped);
  };
  const commit = () => {
    const typed = Number.parseInt(text, 10);
    set(Number.isNaN(typed) ? value : typed);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    const next = {
      ArrowUp: value + step,
      ArrowDown: value - step,
      Home: min,
      End: max,
    }[event.key];
    if (event.key === 'Enter') {
      commit();
      return;
    }
    if (next === undefined) return;
    event.preventDefault();
    set(next);
  };

  return (
    <span className={cn('inline-flex items-center gap-3xs', className)}>
      <button
        type="button"
        tabIndex={-1}
        aria-label={t('quantity.decrease', { label })}
        disabled={disabled || value <= min}
        onClick={() => set(value - step)}
        className={STEP_BUTTON}
      >
        <span aria-hidden="true">−</span>
      </button>
      <input
        id={id}
        type="text"
        role="spinbutton"
        inputMode="numeric"
        aria-label={label}
        aria-valuenow={value}
        aria-valuemin={min}
        aria-valuemax={max}
        disabled={disabled}
        value={text}
        onChange={event => setText(event.currentTarget.value)}
        onBlur={commit}
        onKeyDown={onKeyDown}
        className="w-16 min-h-(--target-min) rounded-lg border border-border-control bg-surface-elevated px-2xs py-3xs text-center text-step-sm text-content tabular-nums focus-ring disabled:cursor-not-allowed disabled:opacity-50"
      />
      <button
        type="button"
        tabIndex={-1}
        aria-label={t('quantity.increase', { label })}
        disabled={disabled || (max !== undefined && value >= max)}
        onClick={() => set(value + step)}
        className={STEP_BUTTON}
      >
        <span aria-hidden="true">+</span>
      </button>
    </span>
  );
}
