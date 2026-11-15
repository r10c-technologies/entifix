import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { expect, userEvent, within } from 'storybook/test';

import { SummaryTile, SummaryTileList } from './summary-tile.js';

const meta: Meta<typeof SummaryTile> = {
  title: 'Molecules/SummaryTile',
  component: SummaryTile,
  tags: ['autodocs'],
  parameters: { layout: 'padded' },
  args: { label: 'Envíos por despachar', href: '#envios', state: 'ready' },
};

export default meta;
type Story = StoryObj<typeof SummaryTile>;

/** A count that leads to the records it counts. */
export const Ready: Story = {
  args: { count: 12 },
  play: async ({ canvasElement }) => {
    const link = within(canvasElement).getByRole('link');
    await expect(link).toHaveAccessibleName(/Envíos por despachar\s*12/);
    await expect(link.getBoundingClientRect().height).toBeGreaterThanOrEqual(
      24,
    );
  },
};

/** Nothing to do is a figure too. */
export const Zero: Story = { args: { count: 0 } };

/** The figure's meaning in a tone and in words. */
export const Toned: Story = {
  args: {
    label: 'Productos agotados',
    count: 3,
    status: { tone: 'danger', label: 'Sin existencias' },
  },
};

/** An amount rather than a count. */
export const MoneyFigure: Story = {
  args: {
    label: 'Próximo pago',
    money: { amount: 128_450, currency: 'GTQ', unit: 'minor' },
  },
};

/** Its place held while its source answers. */
export const Loading: Story = { args: { state: 'loading' } };

/** Its source failed: said in place, with Retry, and the link still there. */
export const Failed: Story = {
  args: { state: 'failed', onRetry: () => undefined },
};

function Today() {
  const [salesState, setSalesState] = useState<'failed' | 'ready'>('failed');
  return (
    <SummaryTileList aria-label="Hoy">
      <SummaryTile
        label="Envíos por despachar"
        href="#envios"
        state="ready"
        count={4}
      />
      <SummaryTile
        label="Ventas de hoy"
        href="#ventas"
        state={salesState}
        count={18}
        onRetry={() => setSalesState('ready')}
      />
      <SummaryTile
        label="Productos agotados"
        href="#existencias"
        state="ready"
        count={2}
        status={{ tone: 'danger', label: 'Sin existencias' }}
      />
      <SummaryTile label="Próximo pago" href="#pagos" state="loading" />
    </SummaryTileList>
  );
}

/**
 * One source fails and its tile says so; the others keep their figures and
 * stay reachable by Tab, and Retry brings the failed one back.
 */
export const OneSourceFails: Story = {
  render: () => <Today />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getAllByRole('listitem')).toHaveLength(4);
    await expect(canvas.getByRole('alert')).toBeVisible();

    await userEvent.tab();
    await expect(
      canvas.getByRole('link', { name: /Envíos por despachar/ }),
    ).toHaveFocus();
    await userEvent.tab();
    await expect(
      canvas.getByRole('link', { name: 'Ventas de hoy' }),
    ).toHaveFocus();
    await userEvent.tab();
    const retry = canvas.getByRole('button');
    await expect(retry).toHaveFocus();
    await userEvent.tab();
    await expect(
      canvas.getByRole('link', { name: /Productos agotados/ }),
    ).toHaveFocus();

    await userEvent.click(retry);
    await expect(canvas.queryByRole('alert')).toBeNull();
    await expect(
      canvas.getByRole('link', { name: /Ventas de hoy\s*18/ }),
    ).toBeVisible();
  },
};
