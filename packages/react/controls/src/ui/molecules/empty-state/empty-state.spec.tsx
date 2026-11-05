import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { EmptyState } from './empty-state.js';

describe('EmptyState', () => {
  it('says what is missing, with one way forward when given', () => {
    render(
      <EmptyState action={<a href="#new">New product</a>}>
        No products yet.
      </EmptyState>,
    );
    expect(screen.getByText('No products yet.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'New product' })).toBeInTheDocument();
  });

  it('renders without an action', () => {
    const { container } = render(<EmptyState>Nothing matches.</EmptyState>);
    expect(container.querySelectorAll('a, button')).toHaveLength(0);
  });
});
