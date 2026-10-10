import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { NavMenu, NavMenuCheck } from './nav-menu.js';

describe('a nav menu', () => {
  it('is a closed disclosure named by its label', () => {
    const { container } = render(
      <NavMenu label="Language" icon={<svg />} summary="EN">
        <a href="/es/">Español</a>
      </NavMenu>,
    );
    const details = container.querySelector('details');
    expect(details?.dataset.slot).toBe('nav-menu');
    expect(details?.open).toBe(false);
    expect(screen.getByLabelText('Language').textContent).toBe('EN');
    expect(
      container.querySelector('[data-slot="nav-menu-chevron"]'),
    ).not.toBeNull();
    expect(
      container.querySelector('[data-slot="nav-menu-panel"]')?.textContent,
    ).toBe('Español');
  });

  it('takes a class and can leave out the chevron', () => {
    const { container } = render(
      <NavMenu
        label="Menu"
        icon={<svg />}
        chevron={false}
        className="nav-menu-sheet"
      >
        <span />
      </NavMenu>,
    );
    expect(container.querySelector('details')?.classList).toContain(
      'nav-menu-sheet',
    );
    expect(
      container.querySelector('[data-slot="nav-menu-chevron"]'),
    ).toBeNull();
  });
});

describe('a menu check', () => {
  it('draws a tick only when checked', () => {
    const { container } = render(
      <>
        <NavMenuCheck checked />
        <NavMenuCheck checked={false} />
      </>,
    );
    const [on, off] = container.querySelectorAll('svg');
    expect(on?.querySelector('path')).not.toBeNull();
    expect(off?.querySelector('path')).toBeNull();
  });
});
