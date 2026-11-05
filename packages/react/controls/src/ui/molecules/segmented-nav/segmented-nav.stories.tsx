import type { Meta, StoryObj } from '@storybook/react-vite';

import { SegmentedNav } from './segmented-nav.js';

const ITEMS = [
  { key: 'overview', label: 'Overview', href: '#overview', current: true },
  { key: 'stock', label: 'Stock', href: '#stock', current: false },
  { key: 'history', label: 'History', href: '#history', current: false },
];

const meta: Meta = {
  title: 'Molecules/SegmentedNav',
  component: SegmentedNav,
  tags: ['autodocs'],
};

export default meta;
type Story = StoryObj;

export const Default: Story = {
  render: () => <SegmentedNav label="Product sections" items={ITEMS} />,
};
