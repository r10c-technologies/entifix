import { render, screen, within } from '@testing-library/react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import type { RenderLink } from '../../actions/render-link.js';
import { PaginationLinks } from './pagination-links.js';

/** A translator that shows the key and its params, so a spec reads what was asked. */
const t = (key: string, params?: Record<string, unknown>) =>
  params === undefined ? key : `${key} ${JSON.stringify(params)}`;

const hrefFor = (page: number) => (page === 1 ? '/list' : `/list?page=${page}`);

const renderLinks = (
  props: Partial<Parameters<typeof PaginationLinks>[0]> = {},
) =>
  render(
    <PaginationLinks
      currentPage={2}
      pageSize={10}
      totalItems={35}
      hrefFor={hrefFor}
      t={t}
      {...props}
    />,
  );

describe('PaginationLinks', () => {
  it('reports the current page, the total pages and the item count', () => {
    renderLinks();

    expect(
      screen.getByText('pagination.summary {"current":2,"total":4,"items":35}'),
    ).toBeInTheDocument();
  });

  it('links Previous, Next and every other page by its address', () => {
    renderLinks();

    expect(
      screen.getByRole('link', { name: 'pagination.previous' }),
    ).toHaveAttribute('href', '/list');
    expect(
      screen.getByRole('link', { name: 'pagination.next' }),
    ).toHaveAttribute('href', '/list?page=3');
    expect(screen.getByRole('link', { name: '4' })).toHaveAttribute(
      'href',
      '/list?page=4',
    );
  });

  it('marks the current page rather than linking it', () => {
    renderLinks();

    const nav = screen.getByRole('navigation', { name: 'pagination.label' });
    expect(within(nav).queryByRole('link', { name: '2' })).toBeNull();
    expect(within(nav).getByText('2')).toHaveAttribute('aria-current', 'page');
  });

  it('keeps Previous on the first page, as text that goes nowhere', () => {
    renderLinks({ currentPage: 1 });

    expect(
      screen.queryByRole('link', { name: 'pagination.previous' }),
    ).toBeNull();
    expect(screen.getByText('pagination.previous')).toHaveAttribute(
      'aria-disabled',
      'true',
    );
  });

  it('keeps Next on the last page, as text that goes nowhere', () => {
    renderLinks({ currentPage: 4 });

    expect(screen.queryByRole('link', { name: 'pagination.next' })).toBeNull();
  });

  it('hides the gap from assistive technology', () => {
    const { container } = renderLinks({ currentPage: 10, totalItems: 200 });

    expect(container.querySelectorAll('[aria-hidden="true"]')).toHaveLength(2);
  });

  it('hands every link to the host renderer with a page intent', () => {
    const renderLink = vi.fn<RenderLink>(({ href, className, children }) => (
      <a href={href} className={className}>
        {children}
      </a>
    ));
    renderLinks({ renderLink });

    expect(renderLink).toHaveBeenCalledWith(
      expect.objectContaining({
        href: '/list?page=3',
        intent: { kind: 'page', page: 3 },
      }),
    );
  });

  /** The reason it exists: no hook, so a server component can render it. */
  it('renders to static markup with no provider around it', () => {
    const html = renderToStaticMarkup(
      <PaginationLinks
        currentPage={1}
        pageSize={10}
        totalItems={5}
        hrefFor={hrefFor}
        t={t}
      />,
    );

    expect(html).toContain('pagination.next');
    expect(html).not.toContain('href="/list?page=2"');
  });
});
