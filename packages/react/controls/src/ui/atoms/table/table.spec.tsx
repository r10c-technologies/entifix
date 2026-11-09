import { act, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { Table, TableBody, TableCell, TableRow } from './table.js';

/** jsdom lays nothing out, so a box's sizes are set by hand. */
const size = (scrollWidth: number, clientWidth: number) => {
  vi.spyOn(HTMLElement.prototype, 'scrollWidth', 'get').mockReturnValue(
    scrollWidth,
  );
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(
    clientWidth,
  );
};

const renderTable = (caption?: string) =>
  render(
    <Table caption={caption}>
      <TableBody>
        <TableRow>
          <TableCell>Acme</TableCell>
        </TableRow>
      </TableBody>
    </Table>,
  );

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('Table', () => {
  it('is named by its caption, and adds no tab stop while it fits', () => {
    size(100, 100);
    const { container } = renderTable('Clientes · 1 resultado');

    expect(screen.getByRole('table')).toHaveAccessibleName(
      'Clientes · 1 resultado',
    );
    expect(container.firstElementChild).not.toHaveAttribute('tabindex');
    expect(screen.queryByRole('region')).not.toBeInTheDocument();
  });

  it('becomes a focusable region named by the caption once it overflows', () => {
    size(400, 100);
    renderTable('Clientes · 1 resultado');

    const region = screen.getByRole('region', {
      name: 'Clientes · 1 resultado',
    });
    expect(region).toHaveAttribute('tabindex', '0');
  });

  it('is focusable without a region role when there is no caption to name it', () => {
    size(400, 100);
    const { container } = renderTable();

    expect(container.firstElementChild).toHaveAttribute('tabindex', '0');
    expect(screen.queryByRole('region')).not.toBeInTheDocument();
  });

  it('measures again when its box or its rows resize', () => {
    let notify: () => void = () => undefined;
    const observe = vi.fn();
    const disconnect = vi.fn();
    vi.stubGlobal(
      'ResizeObserver',
      class {
        constructor(callback: () => void) {
          notify = callback;
        }
        observe = observe;
        disconnect = disconnect;
      },
    );
    size(100, 100);
    const { unmount } = renderTable('Clientes');
    // The container, and the table inside it.
    expect(observe).toHaveBeenCalledTimes(2);

    size(400, 100);
    act(() => notify());
    expect(screen.getByRole('region', { name: 'Clientes' })).toBeVisible();

    unmount();
    expect(disconnect).toHaveBeenCalled();
  });
});
