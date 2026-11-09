import { Forbidden, Unavailable } from '@entifix/core';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { installSpecCatalogs } from '../../../i18n/spec-support/catalogs.js';
import { I18nProvider } from '../../../i18next/index.js';
import { RegionState, type RegionStateProps } from './region-state.js';

installSpecCatalogs();

const renderState = (props: Partial<RegionStateProps>) =>
  render(
    <I18nProvider locale="es">
      <RegionState plural="Facturas" {...props} />
    </I18nProvider>,
  );

describe('RegionState', () => {
  it('says a load failed and retries it', async () => {
    const onRetry = vi.fn();
    renderState({ error: new Unavailable(), onRetry, hasStaleData: true });

    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent(
      'Lo que se muestra puede estar desactualizado.',
    );
    await userEvent.click(screen.getByRole('button', { name: 'Reintentar' }));
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it('says a refusal in its own words, and offers no Retry without a handler', () => {
    renderState({ error: new Forbidden({}), isEmpty: true });

    expect(screen.getByRole('alert')).toHaveTextContent(
      'No tiene permiso para ver facturas.',
    );
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('offers Clear filters when a filter emptied the region', async () => {
    const onClearFilters = vi.fn();
    renderState({ isEmpty: true, isFiltered: true, onClearFilters });

    expect(
      screen.getByText('No hay facturas que coincidan con estos filtros.'),
    ).toBeVisible();
    await userEvent.click(
      screen.getByRole('button', { name: 'Limpiar filtros' }),
    );
    expect(onClearFilters).toHaveBeenCalledOnce();
  });

  it('names a filtered empty region without a way to clear it', () => {
    renderState({ isEmpty: true, isFiltered: true });

    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('says what appears in an empty region, with its first action', () => {
    renderState({ isEmpty: true, emptyAction: <a href="/new">Nueva</a> });

    expect(screen.getByText('Aquí aparecerán sus facturas.')).toBeVisible();
    expect(screen.getByRole('link', { name: 'Nueva' })).toBeVisible();
  });

  it('says nothing while loading or when there is content', () => {
    const { container, rerender } = renderState({
      isLoading: true,
      isEmpty: true,
    });
    expect(container).toBeEmptyDOMElement();

    rerender(
      <I18nProvider locale="es">
        <RegionState plural="Facturas" />
      </I18nProvider>,
    );
    expect(container).toBeEmptyDOMElement();
  });
});
