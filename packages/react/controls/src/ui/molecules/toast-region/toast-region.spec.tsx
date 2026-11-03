import { Forbidden } from '@entifix/core';
import { act, render, renderHook, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { describe, expect, it } from 'vitest';

import { installSpecCatalogs } from '../../../i18n/spec-support/catalogs.js';
import { I18nProvider } from '../../../i18next/index.js';
import { ToastProvider, ToastRegion, useToasts } from './toast-region.js';

installSpecCatalogs();

const wrapper = ({ children }: { children: ReactNode }) => (
  <I18nProvider locale="es">
    <ToastProvider>
      {children}
      <ToastRegion />
    </ToastProvider>
  </I18nProvider>
);

describe('ToastRegion', () => {
  it('renders each failure translated, and keeps it until dismissed', async () => {
    const { result } = renderHook(() => useToasts(), { wrapper });

    act(() => {
      result.current?.showFailure(new Forbidden({}));
      result.current?.showFailure(new Error('the network went away'));
    });

    const alerts = screen.getAllByRole('alert');
    expect(alerts).toHaveLength(2);
    expect(alerts[0]).toHaveTextContent('Sin permiso');
    expect(alerts[1]).toHaveTextContent('the network went away');
    expect(
      screen.getByRole('region', { name: 'Notificaciones' }),
    ).toBeInTheDocument();

    await userEvent.click(
      screen.getAllByRole('button', { name: 'Descartar' })[0] as HTMLElement,
    );
    expect(screen.getAllByRole('alert')).toHaveLength(1);
    expect(result.current?.failures.map(toast => toast.id)).toEqual([2]);
  });

  it('renders nothing, and offers nothing to show into, outside a provider', () => {
    const { container } = render(
      <I18nProvider locale="es">
        <ToastRegion />
      </I18nProvider>,
    );
    expect(container).toBeEmptyDOMElement();
    expect(renderHook(() => useToasts()).result.current).toBeUndefined();
  });
});
