import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { expect, within } from 'storybook/test';

import { Button } from '../../atoms/button/button.js';
import { ConfirmDialog } from './confirm-dialog.js';

function Demo({ tone }: { tone: 'destructive' | 'neutral' }) {
  const [open, setOpen] = useState(true);
  return (
    <>
      <Button onClick={() => setOpen(true)}>Delete Sprocket</Button>
      <ConfirmDialog
        open={open}
        tone={tone}
        title="Delete Sprocket?"
        message="The product and its stock history are removed for good."
        confirmLabel="Delete"
        cancelLabel="Keep it"
        onConfirm={() => setOpen(false)}
        onCancel={() => setOpen(false)}
      />
    </>
  );
}

const meta: Meta = {
  title: 'Molecules/ConfirmDialog',
  component: ConfirmDialog,
  tags: ['autodocs'],
};

export default meta;
type Story = StoryObj;

const isOpen: Story['play'] = async ({ canvasElement }) => {
  const page = within(canvasElement.ownerDocument.body);
  await expect(await page.findByRole('dialog')).toBeVisible();
};

export const Destructive: Story = {
  render: () => <Demo tone="destructive" />,
  play: isOpen,
};

export const Neutral: Story = {
  render: () => <Demo tone="neutral" />,
  play: isOpen,
};
