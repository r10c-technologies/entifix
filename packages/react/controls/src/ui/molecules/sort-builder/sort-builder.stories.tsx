import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, userEvent, within } from 'storybook/test';

import { WIDGET_FIELDS } from '../../story-support/descriptors.js';
import { SortBuilder } from './sort-builder.js';

const meta: Meta = {
  title: 'Molecules/SortBuilder',
  component: SortBuilder,
  tags: ['autodocs'],
  parameters: { layout: 'padded' },
};

export default meta;
type Story = StoryObj;

export const Empty: Story = {
  render: () => (
    <SortBuilder descriptors={WIDGET_FIELDS} onChange={() => undefined} />
  ),
};

/** A sort row being drafted, before it is applied. */
export const Drafting: Story = {
  render: () => (
    <SortBuilder descriptors={WIDGET_FIELDS} onChange={() => undefined} />
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole('button', { name: 'Añadir orden' }));
    await expect(
      canvas.getByRole('button', { name: 'Aplicar orden' }),
    ).toBeVisible();
  },
};
