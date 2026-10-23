import type { Translate } from '../../../i18n/index.js';
import { renderAnchor,type RenderLink } from '../../actions/render-link.js';
import { button } from '../../atoms/button/button-recipe.js';
import { Text } from '../../atoms/text/index.js';
import { cn } from '../../utils/cn.js';
import { pageCount, pageWindow } from './page-math.js';

/** A glyph, not copy: it reads the same in every locale, and it is aria-hidden. */
const GAP = '…';

export interface PaginationLinksProps {
  currentPage: number;
  pageSize: number;
  totalItems: number;
  /** The URL of a page. Page 1 is the host's to spell, usually without `?page`. */
  hrefFor: (page: number) => string;
  /**
   * Resolves this control's keys (`pagination.*`). A server component has no
   * context to read a translator from, so the host hands one over: in a Next
   * host, the server translator for the controls' namespace.
   */
  t: Translate;
  /** Defaults to a plain anchor; a host passes its own link component. */
  renderLink?: RenderLink;
  /** How many page numbers either side of the current one. Defaults to 1. */
  radius?: number;
  className?: string;
}

/**
 * {@link Pagination} as links, and a **server** component.
 *
 * Every page is an address: a crawler follows it, a visitor middle-clicks it,
 * and the page works with JavaScript off. `Pagination` steps through a
 * callback and carries a `'use client'`, which a server-rendered listing
 * cannot use without turning its pager into a client boundary for no gain.
 *
 * Previous and Next stay in the layout at the edges, as text marked
 * `aria-disabled` rather than as links that go nowhere.
 */
export function PaginationLinks({
  currentPage,
  pageSize,
  totalItems,
  hrefFor,
  t,
  renderLink = renderAnchor,
  radius,
  className,
}: PaginationLinksProps) {
  const totalPages = pageCount(totalItems, pageSize);
  const step = button({ variant: 'secondary', size: 'sm' });
  const number = button({ variant: 'ghost', size: 'sm' });
  const unavailable = cn(step, 'pointer-events-none opacity-50');

  const edge = (page: number, label: string, enabled: boolean) =>
    enabled ? (
      renderLink({
        href: hrefFor(page),
        className: step,
        children: label,
        intent: { kind: 'page', page },
      })
    ) : (
      <span aria-disabled="true" className={unavailable}>
        {label}
      </span>
    );

  return (
    <nav
      aria-label={t('pagination.label')}
      className={cn(
        'flex flex-wrap items-center justify-between gap-2xs',
        className,
      )}
    >
      <Text step={-1} tone="muted">
        {t('pagination.summary', {
          current: currentPage,
          total: totalPages,
          items: totalItems,
        })}
      </Text>

      <ol className="flex flex-wrap items-center gap-3xs">
        <li>
          {edge(currentPage - 1, t('pagination.previous'), currentPage > 1)}
        </li>
        {pageWindow(currentPage, totalPages, radius).map(entry =>
          entry.kind === 'gap' ? (
            <li key={`gap-${entry.after}`} aria-hidden="true">
              <Text tone="muted">{GAP}</Text>
            </li>
          ) : (
            <li key={entry.page}>
              {entry.page === currentPage ? (
                <span
                  aria-current="page"
                  className={button({ variant: 'primary', size: 'sm' })}
                >
                  {entry.page}
                </span>
              ) : (
                renderLink({
                  href: hrefFor(entry.page),
                  className: number,
                  children: String(entry.page),
                  intent: { kind: 'page', page: entry.page },
                })
              )}
            </li>
          ),
        )}
        <li>
          {edge(
            currentPage + 1,
            t('pagination.next'),
            currentPage < totalPages,
          )}
        </li>
      </ol>
    </nav>
  );
}
