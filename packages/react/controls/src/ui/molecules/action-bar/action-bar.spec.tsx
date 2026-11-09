import type { UseCaseDescriptor } from '@entifix/core';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { installSpecCatalogs } from '../../../i18n/spec-support/catalogs.js';
import { I18nProvider } from '../../../i18next/index.js';
import { ariaKeyShortcuts, shortcutLabel } from '../../actions/shortcut.js';
import {
  ActionBar,
  type ActionBarItem,
  type ActionBarProps,
  itemsForUseCases,
} from './action-bar.js';

installSpecCatalogs();

const item = (key: string, extra: Partial<ActionBarItem> = {}) => ({
  key,
  label: key,
  onSelect: vi.fn(),
  ...extra,
});

const renderBar = (props: ActionBarProps) =>
  render(
    <I18nProvider locale="es">
      <ActionBar {...props} />
    </I18nProvider>,
  );

const arrangement = (name: 'wide' | 'narrow') =>
  within(document.querySelector(`[data-arrangement="${name}"]`) as HTMLElement);

describe('ActionBar', () => {
  it('renders the primary, three secondaries, then folds the rest', async () => {
    renderBar({
      surface: 'form-header',
      items: [
        item('a'),
        item('b'),
        item('main', { emphasis: 'primary' }),
        item('c'),
        item('d'),
      ],
    });

    const [first] = screen.getAllByRole('button');
    expect(first).toHaveAccessibleName('main');
    expect(
      arrangement('wide').getByRole('button', { name: 'c' }),
    ).toBeVisible();
    expect(
      arrangement('wide').queryByRole('button', { name: 'd' }),
    ).not.toBeInTheDocument();

    await userEvent.click(
      arrangement('wide').getByRole('button', { name: 'Más acciones' }),
    );
    expect(screen.getByRole('menuitem', { name: 'd' })).toBeInTheDocument();
  });

  it('collapses to the primary and one menu holding every secondary', async () => {
    renderBar({
      surface: 'form-footer',
      items: [item('main', { emphasis: 'primary' }), item('a'), item('b')],
    });

    await userEvent.click(
      arrangement('narrow').getByRole('button', { name: 'Más acciones' }),
    );
    expect(
      screen.getAllByRole('menuitem').map(node => node.textContent),
    ).toEqual(['a', 'b']);
  });

  it('keeps a lone secondary a button at every width', () => {
    renderBar({ surface: 'form-footer', items: [item('only')] });

    expect(
      document.querySelector('[data-arrangement="narrow"]'),
    ).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'only' })).toBeInTheDocument();
  });

  it('orders secondaries by priority, then as given, with destructive ones last', async () => {
    renderBar({
      surface: 'bulk-bar',
      items: [
        item('late', { priority: 5 }),
        item('drop', { destructive: true }),
        item('plain'),
        item('first', { priority: 1 }),
        item('wipe', { destructive: true, priority: 0 }),
      ],
    });

    await userEvent.click(
      arrangement('narrow').getByRole('button', { name: 'Más acciones' }),
    );
    expect(
      screen.getAllByRole('menuitem').map(node => node.textContent),
    ).toEqual(['first', 'late', 'plain', 'wipe', 'drop']);
    // A rule stands between "do" and "destroy".
    expect(screen.getByRole('separator')).toBeInTheDocument();
  });

  it('draws a divider before the first visible destructive button', () => {
    const { container } = renderBar({
      surface: 'form-footer',
      items: [item('a'), item('drop', { destructive: true })],
    });

    expect(
      container.querySelector('[data-arrangement="wide"] [aria-hidden="true"]'),
    ).toBeInTheDocument();
  });

  it('runs the selected action', async () => {
    const onSelect = vi.fn();
    renderBar({
      surface: 'form-footer',
      items: [item('go', { emphasis: 'primary', onSelect })],
    });

    await userEvent.click(screen.getByRole('button', { name: 'go' }));
    expect(onSelect).toHaveBeenCalledOnce();
  });

  it('keeps a link a link, beside the primary and never folded', () => {
    const renderLink = vi.fn(({ href, children }) => (
      <a href={href}>{children}</a>
    ));
    renderBar({
      surface: 'table-toolbar',
      renderLink,
      items: [
        item('publish', { emphasis: 'primary' }),
        { key: 'new', label: 'Nuevo', href: '/new' },
        {
          key: 'open',
          label: 'Abrir',
          href: '/1',
          intent: { kind: 'open', id: '1' },
        },
      ],
    });

    expect(screen.getByRole('link', { name: 'Nuevo' })).toHaveAttribute(
      'href',
      '/new',
    );
    expect(renderLink).toHaveBeenCalledWith(
      expect.objectContaining({ intent: { kind: 'new' } }),
    );
    expect(renderLink).toHaveBeenCalledWith(
      expect.objectContaining({ intent: { kind: 'open', id: '1' } }),
    );
  });

  it('renders a primary link through a plain anchor by default', () => {
    renderBar({
      surface: 'table-toolbar',
      items: [
        { key: 'new', label: 'Nuevo', href: '/new', emphasis: 'primary' },
      ],
    });

    expect(screen.getByRole('link', { name: 'Nuevo' })).toHaveAttribute(
      'href',
      '/new',
    );
  });

  it('names its shortcut for both platforms, on a button and in a menu', async () => {
    renderBar({
      surface: 'form-header',
      items: [
        item('save', { emphasis: 'primary', shortcut: 'Mod+S' }),
        item('a', { shortcut: 'Mod+Shift+A' }),
        item('b'),
      ],
    });

    expect(screen.getByRole('button', { name: 'save' })).toHaveAttribute(
      'aria-keyshortcuts',
      'Control+S Meta+S',
    );
    await userEvent.click(
      arrangement('narrow').getByRole('button', { name: 'Más acciones' }),
    );
    expect(screen.getByRole('menuitem', { name: 'a' })).toHaveAttribute(
      'aria-keyshortcuts',
      'Control+Shift+A Meta+Shift+A',
    );
    expect(screen.getByRole('menuitem', { name: 'b' })).not.toHaveAttribute(
      'aria-keyshortcuts',
    );
  });

  it('throws on a second primary', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(() =>
      renderBar({
        surface: 'bulk-bar',
        items: [
          item('a', { emphasis: 'primary' }),
          item('b', { emphasis: 'primary' }),
        ],
      }),
    ).toThrow(/2 primary actions \(a, b\)/);
  });

  it('throws on a destructive primary on a page surface', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    for (const surface of [
      'form-header',
      'form-footer',
      'table-toolbar',
    ] as const)
      expect(() =>
        renderBar({
          surface,
          items: [item('wipe', { emphasis: 'primary', destructive: true })],
        }),
      ).toThrow(/destructive and declared primary/);
  });

  it('keeps a destructive main function outside the menu when it collapses', () => {
    renderBar({
      surface: 'bulk-bar',
      items: [
        item('delete', { emphasis: 'primary', destructive: true }),
        item('a'),
        item('b'),
      ],
    });

    expect(
      arrangement('narrow').queryByRole('button', { name: 'delete' }),
    ).not.toBeInTheDocument();
    const [first] = screen.getAllByRole('button');
    expect(first).toHaveAccessibleName('delete');
  });

  describe('on a row', () => {
    it('puts the inline verb on the row and the rest in a menu named for the record', async () => {
      renderBar({
        surface: 'row-menu',
        menuLabel: 'Acciones para Acme',
        items: [item('archive'), item('tag', { rowInline: true })],
      });

      expect(screen.getByRole('button', { name: 'tag' })).toBeInTheDocument();
      await userEvent.click(
        screen.getByRole('button', { name: 'Acciones para Acme' }),
      );
      expect(
        screen.getByRole('menuitem', { name: 'archive' }),
      ).toBeInTheDocument();
    });

    it('renders no menu when every verb is inline', () => {
      renderBar({
        surface: 'row-menu',
        items: [item('tag', { rowInline: true })],
      });

      expect(screen.getAllByRole('button')).toHaveLength(1);
    });
  });
});

describe('itemsForUseCases', () => {
  it('carries a descriptor’s hierarchy, translated, through one handler', () => {
    const onSelect = vi.fn();
    const descriptor: UseCaseDescriptor = {
      key: 'purge',
      binding: 'entity',
      placement: 'determining',
      labelKey: 'entity:gadget.purge',
      emphasis: 'primary',
      priority: 2,
      rowInline: true,
      shortcut: 'Mod+P',
      confirm: { tone: 'destructive', messageKey: 'entity:gadget.sure' },
    };
    const plain: UseCaseDescriptor = {
      key: 'tag',
      binding: 'entity',
      placement: 'determining',
      labelKey: 'entity:gadget.tag',
    };

    const [first, second] = itemsForUseCases(
      [descriptor, plain],
      key => `«${key}»`,
      onSelect,
      true,
    );
    expect(first).toMatchObject({
      key: 'purge',
      label: '«entity:gadget.purge»',
      emphasis: 'primary',
      priority: 2,
      destructive: true,
      rowInline: true,
      shortcut: 'Mod+P',
      disabled: true,
    });
    expect(second).toMatchObject({
      destructive: false,
      rowInline: false,
      disabled: true,
    });

    first?.onSelect?.();
    expect(onSelect).toHaveBeenCalledWith(descriptor);
    expect(itemsForUseCases([plain], key => key, onSelect)[0]?.disabled).toBe(
      false,
    );
  });
});

describe('shortcutLabel', () => {
  it('reads a chord the way each machine writes it', () => {
    expect(shortcutLabel('Mod+Shift+S', true)).toBe('⌘ShiftS');
    expect(shortcutLabel('Mod+S', false)).toBe('Ctrl+S');
    expect(shortcutLabel('Mod+K')).toBe('Ctrl+K');
  });
});

describe('ariaKeyShortcuts', () => {
  it('names Mod for both platforms, and leaves a chord without it alone', () => {
    expect(ariaKeyShortcuts('Mod+Enter')).toBe('Control+Enter Meta+Enter');
    expect(ariaKeyShortcuts('Shift+F10')).toBe('Shift+F10');
  });
});

describe('ActionBar shortcuts', () => {
  it('binds what it advertises, while the item is enabled', async () => {
    const onSelect = vi.fn();
    const { rerender } = renderBar({
      surface: 'form-footer',
      items: [item('go', { emphasis: 'primary', shortcut: 'Mod+J', onSelect })],
    });

    await userEvent.keyboard('{Control>}j{/Control}');
    expect(onSelect).toHaveBeenCalledOnce();

    rerender(
      <I18nProvider locale="es">
        <ActionBar
          surface="form-footer"
          items={[
            item('go', {
              emphasis: 'primary',
              shortcut: 'Mod+J',
              onSelect,
              disabled: true,
            }),
          ]}
        />
      </I18nProvider>,
    );
    await userEvent.keyboard('{Control>}j{/Control}');
    expect(onSelect).toHaveBeenCalledOnce();
  });

  it('neither binds nor advertises a row’s shortcut: every row would claim it', async () => {
    const onSelect = vi.fn();
    renderBar({
      surface: 'row-menu',
      items: [item('tag', { rowInline: true, shortcut: 'Mod+J', onSelect })],
    });

    expect(screen.getByRole('button', { name: 'tag' })).not.toHaveAttribute(
      'aria-keyshortcuts',
    );
    await userEvent.keyboard('{Control>}j{/Control}');
    expect(onSelect).not.toHaveBeenCalled();
  });
});
