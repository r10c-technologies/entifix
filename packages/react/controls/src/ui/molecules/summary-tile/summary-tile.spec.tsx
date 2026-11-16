import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { installSpecCatalogs } from '../../../i18n/spec-support/catalogs.js';
import { I18nProvider } from '../../../i18next/index.js';
import {
  SummaryTile,
  SummaryTileList,
  type SummaryTileProps,
} from './summary-tile.js';

installSpecCatalogs();

const renderTile = (props: Partial<SummaryTileProps>) =>
  render(
    <I18nProvider locale="es">
      <SummaryTile
        label="Envíos por despachar"
        href="/envios"
        state="ready"
        {...props}
      />
    </I18nProvider>,
  );

describe('SummaryTile', () => {
  it('is one link to what it counts, named by its heading and its count', () => {
    renderTile({ count: 12345 });

    const link = screen.getByRole('link');
    expect(link).toHaveAttribute('href', '/envios');
    expect(link).toHaveAccessibleName(/Envíos por despachar\s*12\.345/);
    expect(
      within(link).getByRole('heading', {
        level: 3,
        name: 'Envíos por despachar',
      }),
    ).toBeInTheDocument();
  });

  it('states zero as a figure, not as nothing', () => {
    renderTile({});

    expect(screen.getByRole('link')).toHaveTextContent('0');
  });

  it('states an amount of money in the reader’s locale', () => {
    renderTile({
      label: 'Próximo pago',
      money: { amount: 6499, currency: 'GTQ', unit: 'minor' },
    });

    expect(screen.getByRole('link')).toHaveTextContent(/64,99/);
  });

  it('shows its status as a tag in words', () => {
    renderTile({ count: 3, status: { tone: 'warning', label: 'Atrasados' } });

    expect(screen.getByText('Atrasados')).toHaveAttribute(
      'data-tone',
      'warning',
    );
  });

  it('holds its figure’s place while it loads, and says so to a screen reader', () => {
    renderTile({
      state: 'loading',
      count: 9,
      status: { tone: 'danger', label: 'Agotado' },
    });

    const link = screen.getByRole('link');
    expect(link).toHaveTextContent('Cargando…');
    expect(link).not.toHaveTextContent('9');
    expect(screen.queryByText('Agotado')).toBeNull();
  });

  it('says it failed in place, keeps its link, and retries its own source', async () => {
    const onRetry = vi.fn();
    renderTile({ state: 'failed', onRetry });

    expect(
      screen.getByRole('link', { name: 'Envíos por despachar' }),
    ).toHaveAttribute('href', '/envios');
    expect(
      screen.getByText('No se pudo cargar Envíos por despachar.'),
    ).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Reintentar' }));
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it('offers no Retry when there is nothing to retry with', () => {
    renderTile({ state: 'failed' });

    expect(screen.queryByRole('button')).toBeNull();
  });

  it('lets a host render the link, passing its class', () => {
    renderTile({
      count: 2,
      renderLink: ({ href, className, children }) => (
        <a href={href} className={className} data-router="yes">
          {children}
        </a>
      ),
    });

    const link = screen.getByRole('link');
    expect(link).toHaveAttribute('data-router', 'yes');
    expect(link.className).toContain('focus-ring');
  });

  it('lets a host render the failed tile’s link too', () => {
    renderTile({
      state: 'failed',
      renderLink: ({ href, className, children }) => (
        <a href={href} className={className} data-router="yes">
          {children}
        </a>
      ),
    });

    expect(screen.getByRole('link')).toHaveAttribute('data-router', 'yes');
  });
});

describe('SummaryTile with a short list', () => {
  const orders = [
    { href: '/pedidos/1', label: 'Pedido 1042', meta: '14 nov.' },
    { href: '/pedidos/2', label: 'Pedido 1041' },
  ];

  it('links its heading to all of them, and each item to its own record', () => {
    renderTile({ label: 'Últimos pedidos', href: '/pedidos', items: orders });

    const heading = screen.getByRole('heading', {
      level: 3,
      name: 'Últimos pedidos',
    });
    expect(within(heading).getByRole('link')).toHaveAttribute(
      'href',
      '/pedidos',
    );
    const list = screen.getByRole('list');
    const links = within(list).getAllByRole('link');
    expect(links.map(link => link.getAttribute('href'))).toEqual([
      '/pedidos/1',
      '/pedidos/2',
    ]);
    expect(links[0]).toHaveAccessibleName('Pedido 1042');
    expect(screen.getByText('14 nov.')).toBeInTheDocument();
    // No link holds another: the tile itself is not one.
    expect(screen.getAllByRole('link')).toHaveLength(3);
  });

  it('says an empty list is empty, in its own words or a neutral one', () => {
    renderTile({ items: [], emptyLabel: 'Aún no hay pedidos.' });
    expect(screen.getByText('Aún no hay pedidos.')).toBeInTheDocument();
    expect(screen.queryByRole('list')).toBeNull();
  });

  it('falls back to a neutral empty line', () => {
    renderTile({
      items: [],
      status: { tone: 'info', label: 'Al día' },
    });
    expect(screen.getByText('Nada por ahora.')).toBeInTheDocument();
    expect(screen.getByText('Al día')).toBeInTheDocument();
  });

  it('holds its place while it loads, with its heading still a link', () => {
    renderTile({ state: 'loading', items: orders });
    expect(screen.getByText('Cargando…')).toBeInTheDocument();
    expect(screen.queryByText('Pedido 1042')).toBeNull();
    expect(screen.getAllByRole('link')).toHaveLength(1);
  });

  it('fails like any tile', () => {
    renderTile({ state: 'failed', items: orders });
    expect(
      screen.getByText('No se pudo cargar Envíos por despachar.'),
    ).toBeInTheDocument();
  });

  it('lets a host render every link it holds', () => {
    renderTile({
      items: orders,
      renderLink: ({ href, className, children }) => (
        <a href={href} className={className} data-router="yes">
          {children}
        </a>
      ),
    });
    for (const link of screen.getAllByRole('link'))
      expect(link).toHaveAttribute('data-router', 'yes');
  });

  it('is a figure, not a list, when it states money', () => {
    renderTile({
      items: orders,
      money: { amount: 6499, currency: 'GTQ', unit: 'minor' },
    });
    expect(screen.queryByRole('list')).toBeNull();
    expect(screen.getByRole('link')).toHaveTextContent(/64,99/);
  });
});

describe('SummaryTileList', () => {
  it('is a list with one item per tile, and passes other children through', () => {
    render(
      <I18nProvider locale="es">
        <SummaryTileList aria-label="Hoy">
          <SummaryTile label="A" href="/a" state="ready" count={1} />
          <SummaryTile label="B" href="/b" state="ready" count={2} />
          {false}
        </SummaryTileList>
      </I18nProvider>,
    );

    const list = screen.getByRole('list', { name: 'Hoy' });
    expect(within(list).getAllByRole('listitem')).toHaveLength(2);
  });
});
