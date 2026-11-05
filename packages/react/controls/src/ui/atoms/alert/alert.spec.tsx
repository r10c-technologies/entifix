import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { Alert, AlertDismiss, InlineMessage } from './index.js';

describe('Alert', () => {
  it('announces danger at once, as an alert and never also a status', () => {
    render(<Alert tone="danger">Could not save</Alert>);
    expect(screen.getByRole('alert')).toHaveTextContent('Could not save');
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it.each(['warning', 'success', 'info'] as const)(
    'announces %s politely, as a status',
    tone => {
      render(<Alert tone={tone}>Heads up</Alert>);
      const status = screen.getByRole('status');
      expect(status).toHaveAttribute('data-tone', tone);
      expect(status.className).toContain(`bg-${tone}-subtle`);
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    },
  );

  it('renders a title and an action when given', () => {
    render(
      <Alert
        tone="info"
        title="Import finished"
        action={<a href="#r">Review</a>}
      >
        12 rows were added.
      </Alert>,
    );
    expect(screen.getByText('Import finished')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Review' })).toBeInTheDocument();
  });

  it('is also exported as InlineMessage', () => {
    expect(InlineMessage).toBe(Alert);
  });
});

describe('AlertDismiss', () => {
  it('is a named button that forwards its click', async () => {
    const onClick = vi.fn();
    const user = userEvent.setup();
    render(<AlertDismiss onClick={onClick} />);
    await user.click(screen.getByRole('button', { name: 'Descartar' }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});
