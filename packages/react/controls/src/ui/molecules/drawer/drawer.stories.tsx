import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { expect, within } from 'storybook/test';

import { Button } from '../../atoms/button/button.js';
import { Drawer } from './drawer.js';

function Demo() {
  const [open, setOpen] = useState(true);
  return (
    <>
      <Button onClick={() => setOpen(true)}>Show filters</Button>
      <Drawer
        open={open}
        onClose={() => setOpen(false)}
        title="Filters"
        closeLabel="Close filters"
      >
        <p>Narrow the list by status, brand or price.</p>
      </Drawer>
    </>
  );
}

const meta: Meta = {
  title: 'Molecules/Drawer',
  component: Drawer,
  tags: ['autodocs'],
};

export default meta;
type Story = StoryObj;

export const Open: Story = {
  render: () => <Demo />,
  play: async ({ canvasElement }) => {
    const page = within(canvasElement.ownerDocument.body);
    await expect(await page.findByRole('dialog')).toBeVisible();
  },
};
