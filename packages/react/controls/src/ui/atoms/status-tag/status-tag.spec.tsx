import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { StatusTag } from './status-tag.js';

describe('StatusTag', () => {
  it.each(['neutral', 'success', 'warning', 'info', 'danger'] as const)(
    'carries the %s tone and its words',
    tone => {
      render(<StatusTag tone={tone}>Published</StatusTag>);
      const tag = screen.getByText('Published');
      expect(tag).toHaveAttribute('data-tone', tone);
    },
  );

  it('hides its icon from assistive technology', () => {
    render(
      <StatusTag tone="success" icon="✓">
        Paid
      </StatusTag>,
    );
    expect(screen.getByText('✓')).toHaveAttribute('aria-hidden', 'true');
    expect(screen.getByText('Paid').textContent).toBe('✓Paid');
  });

  it.each(['', '   '])('refuses to render without words (%j)', text => {
    expect(() => render(<StatusTag tone="danger">{text}</StatusTag>)).toThrow(
      /needs its status in words/,
    );
  });
});
