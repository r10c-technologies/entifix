import type { ComponentType, ReactNode } from 'react';

import { CURRENT, LIST, OTHER } from './segment-classes.js';

/** One segment: a page of its own, the current one marked. */
export interface SegmentedNavItem {
  readonly key: string;
  readonly label: ReactNode;
  readonly href: string;
  readonly current: boolean;
}

/** What renders a segment that leads elsewhere: an `<a>`, or a router's link. */
export type SegmentedNavLink = ComponentType<{
  href: string;
  className?: string;
  children: ReactNode;
}>;

const ANCHOR: SegmentedNavLink = props => <a {...props} />;

/**
 * A choice between pages, drawn as one segmented control: each segment is a
 * link, the current page's is a marked span. A visible label names the
 * choice; the `<nav>` carries it for assistive technology.
 *
 * No hooks, so a server component renders it, and every segment works with
 * scripting off. Its parts carry `data-slot` (`segmented-nav`,
 * `segmented-nav-label`, `segmented-nav-list`, `segmented-nav-item`).
 */
export function SegmentedNav({
  label,
  items,
  link: Link = ANCHOR,
  className,
}: {
  label: string;
  items: readonly SegmentedNavItem[];
  link?: SegmentedNavLink;
  className?: string;
}) {
  return (
    <nav data-slot="segmented-nav" aria-label={label} className={className}>
      <span
        data-slot="segmented-nav-label"
        aria-hidden="true"
        className="text-step-sm text-content-muted"
      >
        {label}
      </span>
      <ul data-slot="segmented-nav-list" className={LIST}>
        {items.map(item => (
          <li
            key={item.key}
            data-slot="segmented-nav-item"
            className="flex-none"
          >
            {item.current ? (
              <span aria-current="page" className={CURRENT}>
                {item.label}
              </span>
            ) : (
              <Link href={item.href} className={OTHER}>
                {item.label}
              </Link>
            )}
          </li>
        ))}
      </ul>
    </nav>
  );
}
