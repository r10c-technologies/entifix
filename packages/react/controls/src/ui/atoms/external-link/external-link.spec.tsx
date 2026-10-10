import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { ExternalLink } from './external-link.js';

describe('an external link', () => {
  it('opens a new tab, with no opener and no referrer', () => {
    render(
      <ExternalLink href="https://example.com" className="x">
        Example
      </ExternalLink>,
    );
    const link = screen.getByRole('link', { name: 'Example' });
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.getAttribute('rel')).toBe('noopener noreferrer');
    expect(link.className).toBe('x');
  });
});
