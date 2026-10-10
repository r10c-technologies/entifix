import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { SplitButton } from './split-button.js';

describe('a split button', () => {
  it('joins the main action to a menu of the related ones', () => {
    const { container } = render(
      <SplitButton
        primary={<a href="/cv.pdf">Download</a>}
        menuLabel="More formats"
        className="extra"
      >
        <a href="/cv-ats.pdf">ATS</a>
      </SplitButton>,
    );
    const root = container.querySelector('[data-slot="split-button"]');
    expect(root?.className).toContain('[&>:first-child]:rounded-r-none');
    expect(root?.className).toContain('extra');
    expect(screen.getByRole('link', { name: 'Download' })).toBeTruthy();
    expect(screen.getByTitle('More formats')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'ATS' })).toBeTruthy();
  });

  it('stands alone with no menu entries', () => {
    const { container } = render(
      <SplitButton
        primary={<a href="/cv.pdf">Download</a>}
        menuLabel="More formats"
      />,
    );
    const root = container.querySelector('[data-slot="split-button"]');
    expect(root?.className).not.toContain('rounded-r-none');
    expect(container.querySelector('details')).toBeNull();
  });
});
