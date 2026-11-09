import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { installSpecCatalogs } from '../../i18n/spec-support/catalogs.js';
import { I18nProvider } from '../../i18next/index.js';
import { RegionState } from '../molecules/region-state/index.js';
import {
  ToastProvider,
  ToastRegion,
  useToasts,
} from '../molecules/toast-region/index.js';
import { type ErrorActions, ErrorActionsProvider } from './error-actions.js';

installSpecCatalogs();

const noOrganization = { message: 'no org', code: 'noActiveOrganization' };

const withActions = (actions: ErrorActions, children: ReactNode) =>
  render(
    <I18nProvider locale="es">
      <ErrorActionsProvider actions={actions}>{children}</ErrorActionsProvider>
    </I18nProvider>,
  );

describe('error actions', () => {
  it('offers the host’s next step when both the handler and its copy exist', async () => {
    const choose = vi.fn();
    withActions(
      { noActiveOrganization: choose },
      <RegionState plural="Clientes" error={noOrganization} />,
    );

    expect(screen.getByRole('alert')).toHaveTextContent(
      'Elija una organización para continuar.',
    );
    await userEvent.click(
      screen.getByRole('button', { name: 'Elegir organización' }),
    );
    expect(choose).toHaveBeenCalledOnce();
  });

  it('offers nothing without a handler for the code', () => {
    withActions({}, <RegionState plural="Clientes" error={noOrganization} />);

    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('offers nothing when the catalog does not name the action', () => {
    withActions(
      { unavailable: vi.fn() },
      <RegionState
        plural="Clientes"
        error={{ message: 'down', details: { code: 'unavailable' } }}
      />,
    );

    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('offers nothing for a failure with no code', () => {
    withActions(
      { noActiveOrganization: vi.fn() },
      <RegionState plural="Clientes" error={{ message: 'boom' }} />,
    );

    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('puts the next step on a failure toast too', async () => {
    const choose = vi.fn();
    function Fail() {
      const toasts = useToasts();
      return (
        <button
          type="button"
          onClick={() =>
            toasts?.show({ tone: 'failure', failure: noOrganization })
          }
        >
          fail
        </button>
      );
    }
    withActions(
      { noActiveOrganization: choose },
      <ToastProvider>
        <Fail />
        <ToastRegion />
      </ToastProvider>,
    );

    await userEvent.click(screen.getByRole('button', { name: 'fail' }));
    await userEvent.click(
      screen.getByRole('button', { name: 'Elegir organización' }),
    );
    expect(choose).toHaveBeenCalledOnce();
  });
});
