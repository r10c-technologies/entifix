import type { Meta, StoryObj } from '@storybook/react-vite';

import { Button } from '../../atoms/button/button.js';
import { EmptyState } from './empty-state.js';

const meta: Meta<typeof EmptyState> = {
  title: 'Molecules/EmptyState',
  component: EmptyState,
  tags: ['autodocs'],
  parameters: { layout: 'padded' },
};

export default meta;
type Story = StoryObj<typeof EmptyState>;

export const WithAction: Story = {
  render: () => (
    <EmptyState action={<Button size="sm">New product</Button>}>
      No products yet. The first one you create appears here.
    </EmptyState>
  ),
};

export const SentenceOnly: Story = {
  render: () => <EmptyState>Nothing matches these filters.</EmptyState>,
};
