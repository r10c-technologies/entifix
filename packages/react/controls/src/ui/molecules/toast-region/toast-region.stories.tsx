import type { Meta, StoryObj } from '@storybook/react-vite';
import { useEffect } from 'react';
import { expect, within } from 'storybook/test';

import { ToastProvider, ToastRegion, useToasts } from './toast-region.js';

/** Raises two failures on mount, as a page whose writes were refused would. */
function Failures() {
  // `showFailure` is stable across renders, so this runs once.
  const show = useToasts()?.showFailure;
  useEffect(() => {
    show?.(new Error('The network went away.'));
    show?.(new Error('The price could not be saved.'));
  }, [show]);
  return <p>Saving the product…</p>;
}

const meta: Meta = {
  title: 'Molecules/ToastRegion',
  component: ToastRegion,
  tags: ['autodocs'],
  parameters: { layout: 'padded' },
};

export default meta;
type Story = StoryObj;

export const Failed: Story = {
  render: () => (
    <ToastProvider>
      <Failures />
      <ToastRegion />
    </ToastProvider>
  ),
  play: async ({ canvasElement }) => {
    const page = within(canvasElement.ownerDocument.body);
    await expect(await page.findAllByRole('alert')).toHaveLength(2);
  },
};
