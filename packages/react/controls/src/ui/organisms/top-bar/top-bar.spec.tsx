import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { TopBar } from './top-bar.js';

describe('TopBar', () => {
  it('renders its slots as a banner', () => {
    render(
      <TopBar>
        <TopBar.Brand>Acme</TopBar.Brand>
        <TopBar.Context>back office</TopBar.Context>
        <TopBar.Actions>
          <button type="button">Menu</button>
        </TopBar.Actions>
      </TopBar>,
    );

    expect(screen.getByRole('banner')).toBeInTheDocument();
    expect(screen.getByText('Acme')).toBeInTheDocument();
    expect(screen.getByText('back office')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Menu' })).toBeInTheDocument();
  });

  it('merges a caller className', () => {
    render(<TopBar className="custom-bar">x</TopBar>);
    expect(screen.getByRole('banner').className).toContain('custom-bar');
  });
});

describe('TopBar live updates', () => {
  it('says nothing while updates flow', () => {
    render(<TopBar>x</TopBar>);

    expect(screen.getByRole('status')).toHaveTextContent('');
  });

  it('says they are paused, offers Reconnect, and says when they resume', async () => {
    const onReconnect = vi.fn();
    const { rerender } = render(
      <TopBar connection="reconnecting" onReconnect={onReconnect}>
        x
      </TopBar>,
    );
    expect(screen.getByRole('status')).toHaveTextContent(
      'Actualizaciones en vivo en pausa — reconectando',
    );
    await userEvent.click(screen.getByRole('button', { name: 'Reconectar' }));
    expect(onReconnect).toHaveBeenCalledOnce();

    rerender(<TopBar connection="closed">x</TopBar>);
    expect(screen.getByRole('status')).toHaveTextContent(
      'Actualizaciones en vivo detenidas',
    );
    expect(screen.queryByRole('button')).not.toBeInTheDocument();

    rerender(<TopBar connection="open">x</TopBar>);
    expect(screen.getByRole('status')).toHaveTextContent(
      'Actualizaciones en vivo reanudadas',
    );
  });
});
