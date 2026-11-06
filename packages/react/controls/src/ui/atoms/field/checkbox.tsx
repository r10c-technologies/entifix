'use client';

import { type ComponentPropsWithoutRef, useEffect, useRef } from 'react';

import { cn } from '../../utils/cn.js';

export interface CheckboxProps extends Omit<
  ComponentPropsWithoutRef<'input'>,
  'type'
> {
  /**
   * The visible caption. Omit it for a box whose meaning comes from where it
   * sits — a row's selection box, where the column header is the caption and
   * the row itself is the subject — and pass `aria-label` instead, so the
   * control still announces itself to a screen reader. A box with neither is
   * unlabelled.
   */
  label?: string;
  /**
   * The third state: some of the rows below are selected, but not all.
   *
   * It is a DOM **property**, not an attribute, so React cannot set it from
   * JSX — `<input indeterminate>` is silently dropped — and it has to be
   * written through a ref after render. That is the whole reason this component
   * is separate from its siblings in `field.tsx`, and the reason it carries
   * `'use client'`: those two are hook-free and stay server-renderable, because
   * the storefront's search page is a Server Component that imports `TextInput`
   * and must not pull a client boundary into a prerendered route.
   */
  indeterminate?: boolean;
}

/**
 * The box is painted at 1rem and HIT at `--target-min` (WCAG 2.5.8, ADR 0025).
 * The input itself is the target-sized element — an input renders no
 * pseudo-element of its own until `appearance: none` hands its painting over,
 * which is what this does — and a negative margin gives the extra back, so the
 * layout still sees a 1rem box at any floor and compact density stays compact. The square,
 * its tick and the indeterminate bar are drawn by `::before` and `::after`
 * with `border-control` and the primary colour; the tick and the bar are
 * borders, so forced colours keep them.
 */
const BOX = [
  'relative size-(--target-min) shrink-0 cursor-pointer appearance-none rounded-sm focus-ring',
  'disabled:cursor-not-allowed disabled:opacity-50',
  // The painted square: 1rem, centred in the target whatever its floor.
  'before:absolute before:inset-[calc((var(--target-min)-(--spacing(4)))/2)] before:rounded-sm before:border before:border-border-control before:bg-surface-elevated',
  'checked:before:border-primary checked:before:bg-primary indeterminate:before:border-primary indeterminate:before:bg-primary',
  // The tick: two borders of a rotated box.
  'checked:after:absolute checked:after:inset-0 checked:after:m-auto checked:after:h-2.5 checked:after:w-1.5 checked:after:-translate-y-px checked:after:rotate-45 checked:after:border-r-2 checked:after:border-b-2 checked:after:border-primary-content',
  // The bar: one border.
  'indeterminate:after:absolute indeterminate:after:top-1/2 indeterminate:after:left-1/2 indeterminate:after:w-2 indeterminate:after:-translate-1/2 indeterminate:after:border-t-2 indeterminate:after:border-primary-content',
].join(' ');

/**
 * A checkbox, with its caption when it has one.
 *
 * Two shapes, and the difference is not cosmetic. With `label` it renders the
 * caption inside a `<label>` and the whole pair is the click target — the form
 * control every other field is. Without one it renders a bare box that takes
 * its meaning from its position, which is what a selection column needs: a
 * caption per row would repeat the column header on every line, and the row's
 * own cells are already the subject.
 */
export function Checkbox({
  label,
  className,
  indeterminate = false,
  ...props
}: CheckboxProps) {
  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => {
    // The effect only runs once the input is mounted, so the ref is always
    // filled here; the guard is what keeps a future refactor that renders the
    // box conditionally from throwing rather than no-op'ing.
    /* v8 ignore next */
    if (ref.current) ref.current.indeterminate = indeterminate;
  }, [indeterminate]);

  const box = (
    <input
      ref={ref}
      type="checkbox"
      className={cn(BOX, label ? undefined : className)}
      {...props}
    />
  );

  if (label === undefined) return box;

  return (
    <label
      className={cn(
        'flex cursor-pointer items-center gap-2xs text-step-sm text-content',
        className,
      )}
    >
      {box}
      {label}
    </label>
  );
}
