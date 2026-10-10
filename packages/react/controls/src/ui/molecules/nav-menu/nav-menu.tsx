import type { ReactNode } from 'react';

import { cn } from '../../utils/cn.js';

/** A bar's trigger: quiet until hovered or open. */
const TRIGGER =
  'focus-ring flex h-[2rem] cursor-pointer list-none items-center gap-3xs rounded-md border border-transparent px-2xs text-step-sm font-medium text-content select-none transition-[background-color,border-color] duration-(--duration-fast,150ms) hover:border-border hover:bg-[color-mix(in_srgb,var(--color-content)_6%,transparent)] [&::-webkit-details-marker]:hidden [[open]>&]:border-border [[open]>&]:bg-[color-mix(in_srgb,var(--color-content)_6%,transparent)]';

/**
 * A dropdown in a navigation bar: a native `<details>` disclosure, so it opens
 * and its links work with scripting off. What a dropdown is expected to do on
 * top — one open at a time, closed by a click elsewhere or Escape — is the
 * page's to add.
 *
 * No hooks, so a client component can render it too. Its parts carry
 * `data-slot` (`nav-menu`, `nav-menu-trigger`, `nav-menu-chevron`,
 * `nav-menu-panel`), so a page can restyle them — a panel as wide as the bar
 * on a phone, say — without knowing the classes underneath.
 */
export function NavMenu({
  label,
  icon,
  summary,
  chevron = true,
  className,
  triggerClassName = TRIGGER,
  children,
}: {
  /** The accessible name of the trigger. */
  label: string;
  icon: ReactNode;
  /** What the trigger shows beside the icon, if anything. */
  summary?: ReactNode;
  /** A chevron after the trigger's content: a menu of choices has one. */
  chevron?: boolean;
  className?: string;
  /** Replaces the trigger's look: a split button draws it as its own segment. */
  triggerClassName?: string;
  children: ReactNode;
}) {
  return (
    <details data-slot="nav-menu" className={cn('relative', className)}>
      <summary
        aria-label={label}
        title={label}
        data-slot="nav-menu-trigger"
        className={triggerClassName}
      >
        {icon}
        {summary}
        {chevron && (
          <svg
            aria-hidden="true"
            viewBox="0 0 24 24"
            data-slot="nav-menu-chevron"
            className="size-[0.875rem] flex-none fill-none stroke-current stroke-2 text-content-muted transition-[rotate] duration-(--duration-fast,150ms) [stroke-linecap:round] [stroke-linejoin:round] [[open]>summary>&]:rotate-180"
          >
            <path d="m7 10 5 5 5-5" />
          </svg>
        )}
      </summary>
      <div
        data-slot="nav-menu-panel"
        className="right-0 ease-out starting:-translate-y-1 [&_ul]:m-0 [&_ul]:p-0 absolute top-[calc(100%+var(--spacing-3xs))] z-60 min-w-[10rem] rounded-lg border border-border bg-surface-elevated p-3xs shadow-[var(--shadow-overlay)] transition-[opacity,translate] duration-[120ms] motion-reduce:transition-none starting:opacity-0 [&_ul]:list-none"
      >
        {children}
      </div>
    </details>
  );
}

/** A check beside the chosen entry; an equal space beside the others. */
export function NavMenuCheck({ checked }: { checked: boolean }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      data-slot="nav-menu-check"
      className="size-[1rem] flex-none fill-none stroke-current stroke-2 [stroke-linecap:round] [stroke-linejoin:round]"
    >
      {checked && <path d="m5 12.5 4.5 4.5L19 7.5" />}
    </svg>
  );
}
