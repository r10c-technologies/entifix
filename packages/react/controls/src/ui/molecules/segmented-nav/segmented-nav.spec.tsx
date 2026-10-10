import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it } from 'vitest';

import { SegmentedNav } from './segmented-nav.js';

const ITEMS = [
  { key: 'human', label: 'Human', href: '/en/cv/', current: true },
  { key: 'ats', label: 'ATS', href: '/en/cv/ats/', current: false },
];

describe('a segmented nav', () => {
  it('links every page but the current one, which it marks', () => {
    render(<SegmentedNav label="Version" items={ITEMS} />);
    const nav = screen.getByRole('navigation', { name: 'Version' });
    expect(nav).toBeTruthy();
    expect(screen.getByText('Human').getAttribute('aria-current')).toBe('page');
    expect(screen.getByRole('link', { name: 'ATS' }).getAttribute('href')).toBe(
      '/en/cv/ats/',
    );
  });

  it('renders a segment through the router’s link when given one', () => {
    const Link = ({
      href,
      className,
      children,
    }: {
      href: string;
      className?: string;
      children: ReactNode;
    }) => (
      <a href={href} className={className} data-router="">
        {children}
      </a>
    );
    render(<SegmentedNav label="Version" items={ITEMS} link={Link} />);
    expect(
      screen.getByRole('link', { name: 'ATS' }).hasAttribute('data-router'),
    ).toBe(true);
  });
});
