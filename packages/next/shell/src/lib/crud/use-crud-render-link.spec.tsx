import { render, screen } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { type EntityNav, EntityNavProvider } from '../workspace/entity-nav.js';
import { useCrudRenderLink } from './use-crud-render-link.js';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));

// `next/link` needs a mounted router; its behaviour is Next's, and what is under
// test is the click this hook takes over.
vi.mock('next/link', () => ({
  default: (props: ComponentProps<'a'>) => <a {...props} />,
}));

function Links() {
  const renderLink = useCrudRenderLink('invoice');
  return (
    <>
      {renderLink({
        href: '/es/invoices/i-1',
        className: 'link',
        children: 'Abrir',
        intent: { kind: 'open', id: 'i-1' },
      })}
      {renderLink({
        href: '/es/invoices/new',
        className: 'link',
        children: 'Nuevo',
        intent: { kind: 'new' },
      })}
      {renderLink({
        href: '/es/invoices',
        className: 'link',
        children: 'Volver',
        intent: { kind: 'back' },
      })}
    </>
  );
}

const makeNav = (): EntityNav => ({ toList: vi.fn(), toEntity: vi.fn() });

/** A click event that reports whether the page claimed it. */
const click = (name: string, init: MouseEventInit = {}) => {
  const event = new MouseEvent('click', {
    bubbles: true,
    cancelable: true,
    button: 0,
    ...init,
  });
  screen.getByRole('link', { name }).dispatchEvent(event);
  return event;
};

describe('useCrudRenderLink', () => {
  it('keeps the real href and styling on every link', () => {
    render(<Links />);

    expect(screen.getByRole('link', { name: 'Abrir' })).toHaveAttribute(
      'href',
      '/es/invoices/i-1',
    );
    expect(screen.getByRole('link', { name: 'Volver' })).toHaveClass('link');
  });

  it('leaves every click to the link on a plain route', () => {
    render(<Links />);

    expect(click('Abrir').defaultPrevented).toBe(false);
  });

  it('opens the record, its create form and the list as tabs under a tab host', () => {
    const nav = makeNav();
    render(
      <EntityNavProvider value={nav}>
        <Links />
      </EntityNavProvider>,
    );

    expect(click('Abrir').defaultPrevented).toBe(true);
    expect(nav.toEntity).toHaveBeenCalledWith('invoice', 'i-1');

    click('Nuevo');
    expect(nav.toEntity).toHaveBeenCalledWith('invoice', 'new');

    click('Volver');
    expect(nav.toList).toHaveBeenCalledWith('invoice');
  });

  // Middle-click, ⌘-click and friends ask for the route in a new browser tab.
  it.each([
    ['a modifier key', { metaKey: true }],
    ['ctrl', { ctrlKey: true }],
    ['shift', { shiftKey: true }],
    ['alt', { altKey: true }],
    ['another button', { button: 1 }],
  ])('leaves a click with %s to the browser', (_label, init) => {
    const nav = makeNav();
    render(
      <EntityNavProvider value={nav}>
        <Links />
      </EntityNavProvider>,
    );

    expect(click('Abrir', init).defaultPrevented).toBe(false);
    expect(nav.toEntity).not.toHaveBeenCalled();
  });

  it('does not take over a click something else already claimed', () => {
    const nav = makeNav();
    render(
      <EntityNavProvider value={nav}>
        <div onClickCapture={event => event.preventDefault()}>
          <Links />
        </div>
      </EntityNavProvider>,
    );

    click('Abrir');
    expect(nav.toEntity).not.toHaveBeenCalled();
  });
});
