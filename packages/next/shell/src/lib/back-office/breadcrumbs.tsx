'use client';

import { splitLocalePath } from '@entifix/core';
import {
  type BreadcrumbItem,
  Breadcrumbs,
  useT,
} from '@entifix/react-controls';
import { usePathname } from 'next/navigation';

import { LocaleLink } from '../i18n/index.js';
import { useBreadcrumbLabels } from './breadcrumb-labels.js';

export interface BackOfficeBreadcrumbsProps {
  /** Map a path segment to an already-translated label; unmapped segments are
   *  title-cased. Hosts resolve these through `useT` — the shell has no way to
   *  know which namespace an app keeps its route names in. */
  labels?: Record<string, string>;
}

function humanize(segment: string): string {
  return segment.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

/** Derives the crumb trail from a pathname. Exported for unit testing. */
export function buildCrumbs(
  pathname: string,
  labels: Record<string, string>,
  homeLabel: string,
): BreadcrumbItem[] {
  const crumbs: BreadcrumbItem[] = [{ label: homeLabel, href: '/' }];
  let href = '';
  // The locale prefix is routing, not a place — a crumb reading "Es" would be
  // both meaningless and un-navigable.
  const { rest } = splitLocalePath(pathname);
  for (const segment of rest.split('/').filter(Boolean)) {
    href += `/${segment}`;
    crumbs.push({ label: labels[segment] ?? humanize(segment), href });
  }
  // The last crumb is the current page: drop its href so it renders as such.
  const last = crumbs[crumbs.length - 1];
  last.href = undefined;
  return crumbs;
}

/**
 * The root crumb is the shell's own copy: it names the shell's `/`, not
 * anything the host app authored. Apps used to pass their brand here
 * ("Admin", "Identidad"), which duplicated what the sidebar already shows.
 */
export function BackOfficeBreadcrumbs({
  labels = {},
}: BackOfficeBreadcrumbsProps) {
  const t = useT('shell');
  const controls = useT();
  const pathname = usePathname() ?? '/';
  // What the page knows about its own segments — a record's name — over what
  // the host mapped; an id never reads as a crumb.
  const pageLabels = useBreadcrumbLabels();
  const items = buildCrumbs(
    pathname,
    { ...labels, ...pageLabels },
    t('breadcrumbs.home'),
  );

  return (
    <Breadcrumbs
      label={controls('breadcrumbs.label')}
      items={items}
      renderLink={item => (
        <LocaleLink href={item.href} className={item.className}>
          {item.label}
        </LocaleLink>
      )}
    />
  );
}
