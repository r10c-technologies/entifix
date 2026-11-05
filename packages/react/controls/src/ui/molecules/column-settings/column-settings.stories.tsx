import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { expect, userEvent, within } from 'storybook/test';

import { ColumnSettings } from './column-settings.js';

const COLUMNS = [
  { name: 'id', label: 'ID' },
  { name: 'name', label: 'Name' },
  { name: 'stock', label: 'Units in stock' },
];

function Controlled() {
  const [hidden, setHidden] = useState<readonly string[]>(['id']);
  return (
    <ColumnSettings
      columns={COLUMNS}
      hidden={hidden}
      onChange={next => setHidden(next.hidden)}
    />
  );
}

const meta: Meta = {
  title: 'Molecules/ColumnSettings',
  component: ColumnSettings,
  tags: ['autodocs'],
};

export default meta;
type Story = StoryObj;

export const Closed: Story = { render: () => <Controlled /> };

/** The panel open, as a user sees it after pressing the trigger. */
export const Open: Story = {
  render: () => <Controlled />,
  play: async ({ canvasElement }) => {
    const page = within(canvasElement.ownerDocument.body);
    await userEvent.click(page.getByRole('button', { name: 'Columnas' }));
    await expect(await page.findByLabelText('Name')).toBeVisible();
  },
};
