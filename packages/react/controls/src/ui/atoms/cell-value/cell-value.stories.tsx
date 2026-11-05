import type { Meta, StoryObj } from '@storybook/react-vite';

import { descriptor } from '../../story-support/descriptors.js';
import { CellValue } from './cell-value.js';

const meta: Meta = {
  title: 'Atoms/CellValue',
  component: CellValue,
  tags: ['autodocs'],
};

export default meta;
type Story = StoryObj;

/** One value per member type, formatted the way a table cell shows it. */
export const ByType: Story = {
  render: () => (
    <dl className="grid grid-cols-2 gap-xs">
      <dt>Text</dt>
      <dd>
        <CellValue value="Sprocket" descriptor={descriptor('name', 'Name')} />
      </dd>
      <dt>Number</dt>
      <dd>
        <CellValue
          value={4310}
          descriptor={descriptor('stock', 'Stock', 'number')}
        />
      </dd>
      <dt>Yes / no</dt>
      <dd>
        <CellValue
          value
          descriptor={descriptor('active', 'Active', 'boolean')}
        />
      </dd>
      <dt>Date</dt>
      <dd>
        <CellValue
          value={new Date('2026-11-05T00:00:00Z')}
          descriptor={descriptor('releasedAt', 'Released', 'date')}
        />
      </dd>
      <dt>Empty</dt>
      <dd>
        <CellValue value={null} descriptor={descriptor('name', 'Name')} />
      </dd>
    </dl>
  ),
};
