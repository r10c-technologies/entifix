import { Forbidden } from '@entifix/core';
import { act, render, renderHook, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { installSpecCatalogs } from '../../../i18n/spec-support/catalogs.js';
import { I18nProvider } from '../../../i18next/index.js';
import {
  TOAST_TIMEOUT_MS,
  ToastProvider,
  ToastRegion,
  useToasts,
} from './toast-region.js';

installSpecCatalogs();

const wrapper = ({ children }: { children: ReactNode }) => (
  <I18nProvider locale="es">
    <ToastProvider>
      {children}
      <ToastRegion />
    </ToastProvider>
  </I18nProvider>
);

afterEach(() => {
  vi.useRealTimers();
});

describe('ToastRegion', () => {
  it('renders each failure translated, and keeps it until dismissed', async () => {
    const { result } = renderHook(() => useToasts(), { wrapper });

    act(() => {
      result.current?.show({ tone: 'failure', failure: new Forbidden({}) });
      result.current?.show({
        tone: 'failure',
        failure: new Error('the network went away'),
      });
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
    expect(result.current?.toasts.map(toast => toast.id)).toEqual([2]);
  });

  it('announces success, undo and info politely, and a failure assertively', () => {
    const { result } = renderHook(() => useToasts(), { wrapper });

    act(() => {
      result.current?.show({ tone: 'success', message: 'Guardado.' });
      result.current?.show({
        tone: 'undo',
        message: 'Eliminado.',
        action: { label: 'Deshacer', onAction: vi.fn() },
      });
      result.current?.show({ tone: 'info', message: 'Para saber.' });
      result.current?.show({ tone: 'failure', failure: new Error('No.') });
    });

    const polite = screen.getAllByRole('status');
    expect(polite).toHaveLength(3);
    expect(polite[0]).toHaveTextContent('Guardado.');
    expect(polite[1]).toHaveTextContent('Eliminado.');
    expect(polite[2]).toHaveTextContent('Para saber.');
    expect(screen.getByRole('alert')).toHaveTextContent('No.');
  });

  it('runs the action, then dismisses the toast that offered it', async () => {
    const { result } = renderHook(() => useToasts(), { wrapper });
    const onAction = vi.fn();

    act(() => {
      result.current?.show({
        tone: 'undo',
        message: 'Eliminado.',
        action: { label: 'Deshacer', onAction },
      });
    });
    await userEvent.click(screen.getByRole('button', { name: 'Deshacer' }));

    expect(onAction).toHaveBeenCalledOnce();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('lets a toast that is not a failure go after its timeout, and keeps a failure', () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useToasts(), { wrapper });

    act(() => {
      result.current?.show({ tone: 'success', message: 'Guardado.' });
      result.current?.show({ tone: 'failure', failure: new Error('No.') });
    });
    act(() => {
      vi.advanceTimersByTime(TOAST_TIMEOUT_MS);
    });

    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(screen.getByRole('alert')).toBeInTheDocument();
  });

  it('clears its pending timeouts on unmount', () => {
    vi.useFakeTimers();
    const { result, unmount } = renderHook(() => useToasts(), { wrapper });
    act(() => {
      result.current?.show({ tone: 'info', message: 'Para saber.' });
    });
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('takes no room and no clicks while empty, and pads the scroll while not', () => {
    const { result } = renderHook(() => useToasts(), { wrapper });
    const region = screen.getByTestId('toast-region');
    const root = document.documentElement;

    expect(region).toHaveClass('size-0', 'pointer-events-none');
    expect(root.style.getPropertyValue('scroll-padding-bottom')).toBe('');

    act(() => {
      result.current?.show({ tone: 'failure', failure: new Error('No.') });
    });
    expect(region).not.toHaveClass('size-0');
    expect(root.style.getPropertyValue('scroll-padding-bottom')).toBe('0px');

    act(() => {
      result.current?.dismiss(1);
    });
    expect(region).toHaveClass('size-0');
    expect(root.style.getPropertyValue('scroll-padding-bottom')).toBe('');
  });

  it('takes focus on F6 while it holds a toast, and ignores other keys', async () => {
    const { result } = renderHook(() => useToasts(), { wrapper });
    const region = screen.getByTestId('toast-region');

    await userEvent.keyboard('{F6}');
    expect(region).not.toHaveFocus();

    act(() => {
      result.current?.show({ tone: 'failure', failure: new Error('No.') });
    });
    await userEvent.keyboard('{F5}');
    expect(region).not.toHaveFocus();
    await userEvent.keyboard('{F6}');
    expect(region).toHaveFocus();
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
