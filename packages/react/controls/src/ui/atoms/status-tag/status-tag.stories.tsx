import type { Meta, StoryObj } from '@storybook/react-vite';

import { StatusTag } from './status-tag.js';

const meta: Meta<typeof StatusTag> = {
  title: 'Atoms/StatusTag',
  component: StatusTag,
  tags: ['autodocs'],
};

export default meta;
type Story = StoryObj<typeof StatusTag>;

/** A tone and the words for it; the colour never stands alone. */
export const Tones: Story = {
  render: () => (
    <div className="flex flex-wrap gap-xs">
      <StatusTag tone="neutral">Draft</StatusTag>
      <StatusTag tone="info">Dispatched</StatusTag>
      <StatusTag tone="success" icon="✓">
        Paid
      </StatusTag>
      <StatusTag tone="warning">Awaiting stock</StatusTag>
      <StatusTag tone="danger">Refused</StatusTag>
    </div>
  ),
};
