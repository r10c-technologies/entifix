import type { EntityFieldDescriptor, FilterGroup } from '@entifix/core';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { expect, userEvent, within } from 'storybook/test';

import { FilterChips } from './filter-chips.js';

const DESCRIPTORS = [
  { name: 'name', key: 'name', label: 'Name', type: 'string' },
  { name: 'stock', key: 'stock', label: 'Units in stock', type: 'number' },
] as EntityFieldDescriptor[];

function Demo() {
  const [value, setValue] = useState<FilterGroup<never>>({
    operator: 'and',
    values: [
      { property: 'name', operator: 'like', value: 'Spro' },
      { property: 'stock', operator: 'gt', value: 100 },
    ] as FilterGroup<never>['values'],
  });
  return (
    <FilterChips descriptors={DESCRIPTORS} value={value} onChange={setValue} />
  );
}

const meta: Meta = {
  title: 'Molecules/FilterChips',
  component: FilterChips,
  tags: ['autodocs'],
};

export default meta;
type Story = StoryObj;

/** The filters in effect, each removable, and Clear all. */
export const Default: Story = {
  render: () => <Demo />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const group = canvas.getByRole('group', { name: 'Filtros aplicados' });
    const [first] = within(group).getAllByRole('button', {
      name: /^Quitar filtro: /,
    });
    await userEvent.click(first as HTMLElement);
    await expect(
      within(group).getAllByRole('button', { name: /^Quitar filtro: / }),
    ).toHaveLength(1);
  },
};
