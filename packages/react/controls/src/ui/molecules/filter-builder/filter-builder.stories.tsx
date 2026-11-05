import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, userEvent, within } from 'storybook/test';

import { WIDGET_FIELDS } from '../../story-support/descriptors.js';
import { FilterBuilder } from './filter-builder.js';

const meta: Meta = {
  title: 'Molecules/FilterBuilder',
  component: FilterBuilder,
  tags: ['autodocs'],
  parameters: { layout: 'padded' },
};

export default meta;
type Story = StoryObj;

export const Empty: Story = {
  render: () => (
    <FilterBuilder descriptors={WIDGET_FIELDS} onChange={() => undefined} />
  ),
};

/** A condition row being drafted, before it is applied. */
export const Drafting: Story = {
  render: () => (
    <FilterBuilder descriptors={WIDGET_FIELDS} onChange={() => undefined} />
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(
      canvas.getByRole('button', { name: 'Añadir filtro' }),
    );
    await expect(
      canvas.getByRole('button', { name: 'Aplicar filtros' }),
    ).toBeVisible();
  },
};
