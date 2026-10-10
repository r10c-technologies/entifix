'use client';

import type { KeyboardEvent } from 'react';

import { cn } from '../../utils/cn.js';
import { CURRENT, LIST, OTHER } from '../segmented-nav/segment-classes.js';

/** A segment as a button: the shared look, without a link's defaults. */
const BUTTON = 'cursor-pointer border-0 font-[inherit]';

/** The keys that move the choice, and where each moves it. */
const MOVES: Readonly<
  Record<string, (index: number, count: number) => number>
> = {
  ArrowRight: (index, count) => (index + 1) % count,
  ArrowDown: (index, count) => (index + 1) % count,
  ArrowLeft: (index, count) => (index - 1 + count) % count,
  ArrowUp: (index, count) => (index - 1 + count) % count,
  Home: () => 0,
  End: (_, count) => count - 1,
};

/**
 * A choice within the page, drawn as `SegmentedNav` draws a choice between
 * pages: one bordered track, the chosen segment filled.
 *
 * A radio group: one segment in the tab order, the arrow keys, Home and End
 * moving the choice and the focus with it. It holds no state; the page keeps
 * the value. Parts carry `data-slot` (`segmented-control`,
 * `segmented-control-option`).
 */
export function SegmentedControl<Key extends string>({
  label,
  options,
  value,
  onChange,
  className,
}: {
  /** The group's accessible name. */
  label: string;
  options: readonly { readonly key: Key; readonly label: string }[];
  value: Key;
  onChange: (key: Key) => void;
  className?: string;
}) {
  const chosen = Math.max(
    0,
    options.findIndex(option => option.key === value),
  );

  const move = (event: KeyboardEvent<HTMLDivElement>) => {
    const to = MOVES[event.key];
    if (to === undefined) return;
    event.preventDefault();
    const next = to(chosen, options.length);
    event.currentTarget
      .querySelectorAll<HTMLElement>('[role="radio"]')
      [next]?.focus();
    onChange((options[next] as (typeof options)[number]).key);
  };

  return (
    <div
      role="radiogroup"
      aria-label={label}
      data-slot="segmented-control"
      onKeyDown={move}
      className={cn(LIST, className)}
    >
      {options.map((option, index) => {
        const checked = index === chosen;
        return (
          <button
            key={option.key}
            type="button"
            role="radio"
            aria-checked={checked}
            tabIndex={checked ? 0 : -1}
            data-slot="segmented-control-option"
            className={cn(
              checked ? `${CURRENT} focus-ring` : `${OTHER} bg-transparent`,
              BUTTON,
            )}
            onClick={() => onChange(option.key)}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
