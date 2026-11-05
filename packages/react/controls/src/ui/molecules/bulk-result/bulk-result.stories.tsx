import type { Meta, StoryObj } from '@storybook/react-vite';

import { BulkResult } from './bulk-result.js';

const NAMES: Record<string, string> = {
  'w-1': 'Sprocket',
  'w-2': 'Flange',
  'w-3': 'Grommet',
};

const meta: Meta = {
  title: 'Molecules/BulkResult',
  component: BulkResult,
  tags: ['autodocs'],
  parameters: { layout: 'padded' },
};

export default meta;
type Story = StoryObj;

export const AllSucceeded: Story = {
  render: () => (
    <BulkResult
      outcomes={[
        { id: 'w-1', ok: true },
        { id: 'w-2', ok: true },
      ]}
      labelFor={id => NAMES[String(id)]}
      onDismiss={() => undefined}
    />
  ),
};

/** One row refused: the failure is named, and only it is retried. */
export const PartialFailure: Story = {
  render: () => (
    <BulkResult
      outcomes={[
        { id: 'w-1', ok: true },
        { id: 'w-2', ok: false, code: 'forbidden' },
        { id: 'w-3', ok: true },
      ]}
      labelFor={id => NAMES[String(id)]}
      onRetryFailed={() => undefined}
      onDismiss={() => undefined}
    />
  ),
};
