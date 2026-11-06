import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { Tab, TabAddButton, TabPanel, TabStrip } from './tab-strip.js';

const strip = (
  active: string | null,
  handlers: {
    onSelect?: (id: string) => void;
    onClose?: (id: string) => void;
  } = {},
) => (
  <TabStrip actions={<TabAddButton />}>
    {['products', 'brands', 'orders'].map(id => (
      <Tab
        key={id}
        id={`tab-${id}`}
        controls="panel"
        label={id}
        active={id === active}
        onSelect={() => handlers.onSelect?.(id)}
        onClose={handlers.onClose && (() => handlers.onClose?.(id))}
      />
    ))}
  </TabStrip>
);

describe('TabStrip', () => {
  it('is a named tablist that owns only its tabs', () => {
    render(strip('products'));
    const list = screen.getByRole('tablist', {
      name: 'Pestañas del espacio de trabajo',
    });

    expect(
      list.querySelectorAll('button:not([role="tab"]):not([aria-hidden])'),
    ).toHaveLength(0);
    // The add button is beside the list, not in it.
    expect(list).not.toContainElement(
      screen.getByRole('button', { name: 'Abrir una pestaña nueva' }),
    );
  });

  it('takes its name from `label` when given', () => {
    render(<TabStrip label="Open records" />);
    expect(
      screen.getByRole('tablist', { name: 'Open records' }),
    ).toBeInTheDocument();
  });

  it('is one Tab stop: the active tab', async () => {
    const user = userEvent.setup();
    render(strip('brands'));
    const tabs = screen.getAllByRole('tab');

    expect(tabs.map(tab => tab.tabIndex)).toEqual([-1, 0, -1]);
    await user.tab();
    expect(screen.getByRole('tab', { name: 'brands' })).toHaveFocus();
    await user.tab();
    expect(
      screen.getByRole('button', { name: 'Abrir una pestaña nueva' }),
    ).toHaveFocus();
  });

  it('makes the first tab the Tab stop when none is active', () => {
    render(strip(null));
    expect(screen.getAllByRole('tab').map(tab => tab.tabIndex)).toEqual([
      0, -1, -1,
    ]);
  });

  it('moves focus with Arrow keys (wrapping), Home and End, without activating', async () => {
    const onSelect = vi.fn();
    const user = userEvent.setup();
    render(strip('products', { onSelect }));
    await user.tab();

    await user.keyboard('{ArrowRight}');
    expect(screen.getByRole('tab', { name: 'brands' })).toHaveFocus();
    await user.keyboard('{End}');
    expect(screen.getByRole('tab', { name: 'orders' })).toHaveFocus();
    await user.keyboard('{ArrowRight}');
    expect(screen.getByRole('tab', { name: 'products' })).toHaveFocus();
    await user.keyboard('{ArrowLeft}');
    expect(screen.getByRole('tab', { name: 'orders' })).toHaveFocus();
    await user.keyboard('{Home}');
    expect(screen.getByRole('tab', { name: 'products' })).toHaveFocus();
    expect(onSelect).not.toHaveBeenCalled();

    await user.keyboard('{ArrowRight}{Enter}');
    expect(onSelect).toHaveBeenCalledWith('brands');
  });

  it('ignores other keys, and keys from outside a tab', async () => {
    const user = userEvent.setup();
    render(
      <TabStrip>
        <Tab id="a" label="a" active />
        <input aria-label="stray" />
      </TabStrip>,
    );
    await user.tab();
    await user.keyboard('x');
    expect(screen.getByRole('tab', { name: 'a' })).toHaveFocus();
    await user.click(screen.getByRole('textbox', { name: 'stray' }));
    await user.keyboard('{Home}');
    expect(screen.getByRole('textbox', { name: 'stray' })).toHaveFocus();
  });

  it('closes the focused tab with Delete', async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(strip('products', { onClose }));
    await user.tab();
    await user.keyboard('{ArrowRight}{Delete}');

    expect(onClose).toHaveBeenCalledWith('brands');
    expect(screen.getByRole('tab', { name: 'brands' })).toHaveAttribute(
      'aria-keyshortcuts',
      'Delete',
    );
  });
});

describe('Tab', () => {
  it('marks the active tab, controls its panel and shows its accent bar', () => {
    render(<Tab id="t" controls="p" label="Products" active />);
    const tab = screen.getByRole('tab');

    expect(tab).toHaveAttribute('aria-selected', 'true');
    expect(tab).toHaveAttribute('aria-controls', 'p');
    expect(tab.parentElement?.className).toContain('bg-surface-elevated');
  });

  it('is unselected by default, controls nothing, and has no indicator', () => {
    render(<Tab id="t" controls="p" label="Brands" />);
    const tab = screen.getByRole('tab');

    expect(tab).toHaveAttribute('aria-selected', 'false');
    expect(tab).not.toHaveAttribute('aria-controls');
    expect(tab).not.toHaveAttribute('aria-keyshortcuts');
    expect(screen.queryByTestId('tab-indicator')).not.toBeInTheDocument();
  });

  it('selects on click', async () => {
    const onSelect = vi.fn();
    const user = userEvent.setup();
    render(<Tab id="t" label="Products" onSelect={onSelect} />);

    await user.click(screen.getByText('Products'));

    expect(onSelect).toHaveBeenCalledTimes(1);
  });

  it('ignores Delete when it cannot close', async () => {
    const user = userEvent.setup();
    render(<Tab id="t" label="Products" active />);
    await user.tab();
    await user.keyboard('{Delete}');
    expect(screen.getByRole('tab')).toBeInTheDocument();
  });

  it.each([
    ['dirty', 'bg-accent', false, 'cambios sin guardar'],
    ['saving', 'bg-accent', true, 'guardando'],
    ['error', 'bg-danger', false, 'sin guardar'],
  ] as const)(
    'says %s in words beside its dot',
    (state, tone, pulses, words) => {
      render(<Tab id="t" label="Acme" state={state} />);
      const dot = screen.getByTestId('tab-indicator');

      expect(dot.className).toContain(tone);
      expect(dot.className.includes('animate-pulse')).toBe(pulses);
      expect(screen.getByRole('tab')).toHaveAccessibleName(`Acme, ${words}`);
    },
  );

  it('turns the tab to danger on error', () => {
    render(<Tab id="t" label="Acme" state="error" />);
    expect(screen.getByRole('tab').parentElement?.className).toContain(
      'bg-danger-subtle',
    );
  });

  it('closes from its × by pointer, which is hidden from assistive technology', async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    const { container } = render(<Tab id="t" label="Acme" onClose={onClose} />);
    const close = container.querySelector('button[aria-hidden="true"]')!;

    expect(close).toHaveAttribute('tabindex', '-1');
    expect(close).toHaveAttribute('title', 'Cerrar Acme');
    await user.click(close);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('keeps the × visible on the active tab', () => {
    const { container } = render(
      <Tab id="t" label="Acme" active onClose={() => undefined} />,
    );
    expect(
      container.querySelector('button[aria-hidden="true"]')?.className,
    ).toContain('opacity-100');
  });
});

describe('TabPanel', () => {
  it('is a focusable tabpanel labelled by its tab', () => {
    render(
      <>
        <Tab id="t" controls="p" label="Products" active />
        <TabPanel id="p" labelledBy="t">
          body
        </TabPanel>
      </>,
    );
    const panel = screen.getByRole('tabpanel', { name: 'Products' });

    expect(panel).toHaveAttribute('tabindex', '0');
    expect(panel).toHaveTextContent('body');
  });
});

describe('TabAddButton', () => {
  it('is labelled and forwards its click', async () => {
    const onClick = vi.fn();
    const user = userEvent.setup();
    render(<TabAddButton onClick={onClick} />);

    await user.click(
      screen.getByRole('button', { name: 'Abrir una pestaña nueva' }),
    );

    expect(onClick).toHaveBeenCalledTimes(1);
  });
});
