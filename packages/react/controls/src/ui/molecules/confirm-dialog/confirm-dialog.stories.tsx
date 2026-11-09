import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { expect, within } from 'storybook/test';

import { Button } from '../../atoms/button/button.js';
import { ConfirmDialog } from './confirm-dialog.js';

function Demo({
  tone,
  typed,
}: {
  tone: 'destructive' | 'neutral';
  typed?: string;
}) {
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
        typed={typed}
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
  await expect(await page.findByRole('alertdialog')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Keep it' })).toHaveFocus();
};

export const Destructive: Story = {
  render: () => <Demo tone="destructive" />,
  play: isOpen,
};

export const Neutral: Story = {
  render: () => <Demo tone="neutral" />,
  play: isOpen,
};

/** A destruction too large for one click: the name has to be typed first. */
export const Typed: Story = {
  render: () => <Demo tone="destructive" typed="Sprocket" />,
  play: async context => {
    await isOpen?.(context);
    const page = within(context.canvasElement.ownerDocument.body);
    await expect(page.getByRole('button', { name: 'Delete' })).toBeDisabled();
  },
};
