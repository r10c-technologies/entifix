import type { ComponentPropsWithoutRef, ReactNode } from 'react';

/** The label: the switch, then its text, on one line. */
const LABEL = 'inline-flex cursor-pointer items-center gap-3xs';

/**
 * Off: an outlined track, its thumb muted at the start. On: filled with the
 * primary colour, its thumb the surface's, at the end.
 */
const TRACK =
  'relative inline-flex h-[1.125rem] w-8 shrink-0 items-center rounded-full border border-border-control bg-transparent transition-colors motion-reduce:transition-none peer-checked:border-primary peer-checked:bg-primary peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-focus-ring peer-disabled:cursor-not-allowed peer-disabled:opacity-50 peer-checked:[&>span]:translate-x-[0.875rem] peer-checked:[&>span]:bg-surface';

// Forced colours paint every background as Canvas, which would erase the
// thumb — the only thing that shows the switch's state there — so it takes
// the system's text colour instead.
const THUMB =
  'ml-[0.125rem] size-3 rounded-full bg-content-muted transition-[translate,background-color] motion-reduce:transition-none forced-colors:bg-[CanvasText]';

/**
 * An on/off choice: a native checkbox announced as a switch, drawn as a track
 * and a thumb. The checkbox keeps the keyboard, the form and `onChange`; the
 * track only shows its state.
 */
export function Switch({
  children,
  className,
  ...input
}: Omit<ComponentPropsWithoutRef<'input'>, 'type' | 'role' | 'children'> & {
  children: ReactNode;
}) {
  return (
    <label data-slot="switch" className={className ?? LABEL}>
      <input
        {...input}
        type="checkbox"
        role="switch"
        data-slot="switch-input"
        className="peer sr-only"
      />
      <span data-slot="switch-track" aria-hidden="true" className={TRACK}>
        <span data-slot="switch-thumb" className={THUMB} />
      </span>
      {children}
    </label>
  );
}
