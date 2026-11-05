import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';

import { SegmentedControl } from './segmented-control.js';

const OPTIONS = [
  { key: 'list', label: 'List' },
  { key: 'chart', label: 'Chart' },
  { key: 'both', label: 'Both' },
] as const;

type View = (typeof OPTIONS)[number]['key'];

function Controlled() {
  const [value, setValue] = useState<View>('list');
  return (
    <SegmentedControl
      label="View"
      options={OPTIONS}
      value={value}
      onChange={setValue}
    />
  );
}

const meta: Meta = {
  title: 'Molecules/SegmentedControl',
  component: SegmentedControl,
  tags: ['autodocs'],
};

export default meta;
type Story = StoryObj;

export const Default: Story = { render: () => <Controlled /> };
