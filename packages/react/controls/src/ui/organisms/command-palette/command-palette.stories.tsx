import type { CommandPage } from '@entifix/core';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { expect, userEvent, within } from 'storybook/test';

import { indicatorContrast } from '../../../../.storybook/indicator.js';
import { Button } from '../../atoms/button/button.js';
import { CommandPalette } from './command-palette.js';

const LABELS = {
  title: 'Buscar o ejecutar',
  empty: 'Sin resultados',
  loading: 'Buscando…',
  more: (remaining: number) => `${remaining} más`,
  back: 'Volver',
};

const ROOT: CommandPage = {
  id: 'root',
  placeholder: 'Escribe para buscar…',
  sources: [
    {
      key: 'commands',
      groups: [
        {
          key: 'commands',
          label: 'Comandos',
          isLoading: false,
          options: [
            { id: 'new-product', label: 'Nuevo producto', href: '#new' },
            { id: 'open-orders', label: 'Ver pedidos', href: '#orders' },
          ],
        },
      ],
    },
    {
      key: 'records',
      groups: [
        {
          key: 'products',
          label: 'Productos',
          isLoading: false,
          total: 12,
          options: [
            {
              id: 'w-1',
              label: 'Sprocket',
              sublabel: '1,200 en stock',
              href: '#w-1',
            },
            {
              id: 'w-2',
              label: 'Flange',
              sublabel: '87 en stock',
              href: '#w-2',
            },
          ],
        },
      ],
    },
  ],
};

function Demo() {
  const [open, setOpen] = useState(true);
  const [stack, setStack] = useState<readonly string[]>([]);
  const [term, setTerm] = useState('');
  return (
    <>
      <Button onClick={() => setOpen(true)}>Search</Button>
      <CommandPalette
        open={open}
        onClose={() => setOpen(false)}
        pages={[ROOT]}
        stack={stack}
        onStackChange={setStack}
        term={term}
        onTermChange={setTerm}
        onSelect={() => setOpen(false)}
        labels={LABELS}
      />
    </>
  );
}

const meta: Meta = {
  title: 'Organisms/CommandPalette',
  component: CommandPalette,
  tags: ['autodocs'],
};

export default meta;
type Story = StoryObj;

export const Open: Story = {
  render: () => <Demo />,
  play: async ({ canvasElement }) => {
    const page = within(canvasElement.ownerDocument.body);
    await expect(
      await page.findByRole('dialog', { name: LABELS.title }),
    ).toBeVisible();
  },
};

/** Set by the gate (`test-a11y`) for every cell; absent in `storybook dev`. */
const GATED = import.meta.env['STORYBOOK_A11Y_CELL'] !== undefined;

/** 36rem, `--container-xl` in Tailwind's default theme. */
const PANEL_MIN_INLINE = 36 * 16;

/**
 * The panel is a container width, not a spacing value: `max-w-xl` once
 * resolved through `--spacing-xl` and measured 40px wide at fixed + compact,
 * clipping what was typed and every result (ADR 0025). At a desktop viewport
 * it reaches the container width in every cell.
 */
export const Width: Story = {
  parameters: { gate: { viewport: { width: 1280, height: 800 } } },
  render: () => <Demo />,
  play: async ({ canvasElement }) => {
    const page = within(canvasElement.ownerDocument.body);
    await page.findByRole('dialog', { name: LABELS.title });
    // The panel, not the dialog: the dialog is the full-screen positioner.
    const panel = page.getByTestId('command-palette');
    const viewport = canvasElement.ownerDocument.documentElement.clientWidth;
    await expect(viewport).toBeGreaterThanOrEqual(GATED ? 1280 : 0);
    await expect(panel.getBoundingClientRect().width).toBeGreaterThanOrEqual(
      Math.min(PANEL_MIN_INLINE, viewport - 64),
    );
  },
};

/**
 * Focus has one visual language: the input shows a ring while it holds focus,
 * and the result under the keyboard wears the same ring, 3:1 on the panel.
 */
export const Keyboard: Story = {
  render: () => <Demo />,
  play: async ({ canvasElement }) => {
    const page = within(canvasElement.ownerDocument.body);
    const input = await page.findByRole('combobox');
    await expect(input).toHaveFocus();
    await expect(getComputedStyle(input).outlineStyle).not.toBe('none');
    await userEvent.keyboard('{ArrowDown}{ArrowDown}');
    const panel = page.getByTestId('command-palette');
    const active = panel.querySelector('[role="option"][data-focus]');
    await expect(active).not.toBeNull();
    await expect(indicatorContrast(active!, panel)).toBeGreaterThanOrEqual(3);
  },
};
