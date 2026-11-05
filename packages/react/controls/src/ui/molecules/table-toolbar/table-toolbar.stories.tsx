import type { Meta, StoryObj } from '@storybook/react-vite';

import { Button } from '../../atoms/button/button.js';
import { TextInput } from '../../atoms/field/field.js';
import { TableToolbar } from './table-toolbar.js';

const meta: Meta = {
  title: 'Molecules/TableToolbar',
  component: TableToolbar,
  tags: ['autodocs'],
  parameters: { layout: 'padded' },
};

export default meta;
type Story = StoryObj;

export const Default: Story = {
  render: () => (
    <TableToolbar
      start={<TextInput aria-label="Search products" placeholder="Search…" />}
      end={<Button size="sm">Filters</Button>}
    />
  ),
};

/** With the panel a toolbar button opens beneath it. */
export const WithPanel: Story = {
  render: () => (
    <TableToolbar
      start={<TextInput aria-label="Search products" placeholder="Search…" />}
      end={<Button size="sm">Filters</Button>}
      panel={<p>Status is active, and stock is over 100.</p>}
    />
  ),
};
