import type { Meta, StoryObj } from '@storybook/react-vite';

import { Button } from '../../atoms/button/button.js';
import { Checkbox } from '../../atoms/field/checkbox.js';
import { EntityRecordCard } from './entity-record-card.js';

const COLUMNS = [
  { name: 'name', label: 'Name' },
  { name: 'stock', label: 'Units in stock' },
];

const VALUES: Record<string, string> = { name: 'Sprocket', stock: '1,200' };

const meta: Meta = {
  title: 'Molecules/EntityRecordCard',
  component: EntityRecordCard,
  tags: ['autodocs'],
};

export default meta;
type Story = StoryObj;

/** One record as the table shows it below the card breakpoint. */
export const Default: Story = {
  render: () => (
    <EntityRecordCard
      columns={COLUMNS}
      renderCell={column => VALUES[column.name]}
      leading={<Checkbox label="Select Sprocket" />}
      actions={<Button size="sm">Open</Button>}
    />
  ),
};
