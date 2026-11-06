import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, within } from 'storybook/test';

import { Alert, AlertDismiss } from './index.js';

const meta: Meta<typeof Alert> = {
  title: 'Atoms/Alert',
  component: Alert,
  tags: ['autodocs'],
};

export default meta;
type Story = StoryObj<typeof Alert>;

/** Every tone, each on its own `-subtle` surface. */
export const Tones: Story = {
  render: () => (
    <div className="flex max-w-(--container-xl) flex-col gap-s">
      <Alert tone="danger" title="Could not save">
        The server did not answer. Your changes are kept in this tab.
      </Alert>
      <Alert tone="warning" title="Unpublished changes">
        Two offerings differ from what the storefront shows.
      </Alert>
      <Alert tone="success">The order was refunded.</Alert>
      <Alert tone="info" action={<AlertDismiss />}>
        Prices now include tax.
      </Alert>
    </div>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getAllByRole('alert')).toHaveLength(1);
    await expect(canvas.getAllByRole('status')).toHaveLength(3);
  },
};
