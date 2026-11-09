import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, within } from 'storybook/test';

import { Button } from '../../atoms/button/button.js';
import { Checkbox } from '../../atoms/field/checkbox.js';
import { EntityRecordCard } from './entity-record-card.js';

const meta: Meta = {
  title: 'Molecules/EntityRecordCard',
  component: EntityRecordCard,
  tags: ['autodocs'],
};

export default meta;
type Story = StoryObj;

/** One record as the table shows it below its pivot width. */
export const Default: Story = {
  render: () => (
    <ul role="list" className="m-0 p-0 list-none">
      <li>
        <EntityRecordCard
          title={<a href="#sprocket">Sprocket</a>}
          meta={[{ key: 'stock', label: 'Units in stock', value: '1,200' }]}
          leading={<Checkbox aria-label="Select Sprocket" />}
          actions={<Button size="sm">Actions for Sprocket</Button>}
        />
      </li>
    </ul>
  ),
  play: async ({ canvasElement }) => {
    const card = within(canvasElement).getByRole('article', {
      name: 'Sprocket',
    });
    await expect(
      within(card).getByRole('heading', { level: 3, name: 'Sprocket' }),
    ).toBeVisible();
    await expect(within(card).getAllByRole('link')).toHaveLength(1);
  },
};
