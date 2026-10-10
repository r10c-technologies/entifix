'use client';

import type { KeyboardEvent, MouseEvent, ReactNode } from 'react';

import { cn } from '../../utils/cn.js';

export interface SplitViewItem {
  readonly id: string;
  /** What the list shows of the item: its number and title, say. */
  readonly head: ReactNode;
  /** What the pane shows once the item is chosen. */
  readonly detail: ReactNode;
  /** Where the item lives on its own: followed without scripting. */
  readonly href: string;
}

/** The keys that move the choice, and where each moves it. */
const MOVES: Readonly<
  Record<string, (index: number, count: number) => number>
> = {
  ArrowDown: (index, count) => Math.min(index + 1, count - 1),
  ArrowUp: index => Math.max(index - 1, 0),
  Home: () => 0,
  End: (_, count) => count - 1,
};

/**
 * A list beside a reading pane: the chosen item's detail shows next to the
 * list on a wide screen, and under its own row on a narrow one, where the
 * list reads as an accordion.
 *
 * One markup for both: the chosen row carries its detail. On a wide screen
 * the list is a column of fixed height that scrolls, and the detail is placed
 * against the whole view, so the list's overflow neither clips nor scrolls it.
 *
 * Each row is a link to the item's own page, which is what a visitor without
 * scripting follows. With it, a plain click chooses instead, and ↑, ↓, Home
 * and End move the choice, focus following it (one row in the tab order).
 * Parts carry `data-slot` (`split-view`, `split-list`, `split-row`,
 * `split-trigger`, `split-detail`) for a page to restyle.
 */
export function SplitView({
  label,
  items,
  selected,
  onSelect,
  className,
}: {
  /** The list's accessible name. */
  label: string;
  items: readonly SplitViewItem[];
  /** The chosen item's id; an unknown one chooses nothing. */
  selected: string | undefined;
  onSelect: (id: string) => void;
  className?: string;
}) {
  const index = items.findIndex(item => item.id === selected);
  const focusable = index === -1 ? 0 : index;

  const choose = (event: MouseEvent, id: string) => {
    // A new tab or window is the link's own business.
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey)
      return;
    event.preventDefault();
    onSelect(id);
  };

  const move = (event: KeyboardEvent<HTMLOListElement>) => {
    const to = MOVES[event.key];
    if (to === undefined) return;
    event.preventDefault();
    const next = to(focusable, items.length);
    event.currentTarget
      .querySelectorAll<HTMLElement>('[data-slot="split-trigger"]')
      [next]?.focus();
    onSelect((items[next] as SplitViewItem).id);
  };

  return (
    <div
      data-slot="split-view"
      className={cn('lg:min-h-[28rem] relative', className)}
    >
      <ol
        data-slot="split-list"
        aria-label={label}
        onKeyDown={move}
        className="m-0 p-0 lg:max-h-[28rem] lg:w-[40%] lg:overflow-y-auto list-none"
      >
        {items.map((item, at) => {
          const chosen = at === index;
          return (
            <li key={item.id} data-slot="split-row">
              <a
                href={item.href}
                data-slot="split-trigger"
                aria-current={chosen ? 'true' : undefined}
                tabIndex={at === focusable ? 0 : -1}
                onClick={event => choose(event, item.id)}
                className="block rounded-md px-xs py-2xs text-inherit no-underline focus-ring hover:bg-[color-mix(in_srgb,var(--color-content)_6%,transparent)] aria-[current]:bg-[color-mix(in_srgb,var(--color-primary)_14%,transparent)]"
              >
                {item.head}
              </a>
              {chosen && (
                <div
                  data-slot="split-detail"
                  className="lg:absolute lg:top-0 lg:right-0 lg:max-h-[28rem] lg:w-[58%] lg:overflow-y-auto lg:p-0 px-xs py-s"
                >
                  {item.detail}
                </div>
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
