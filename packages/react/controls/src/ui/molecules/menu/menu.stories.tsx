import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, userEvent, within } from 'storybook/test';

import { Menu } from './menu.js';

const meta = {
  title: 'Molecules/Menu',
  component: Menu,
  tags: ['autodocs'],
} satisfies Meta<typeof Menu>;

export default meta;
type Story = StoryObj<typeof meta>;

export const UserMenu: Story = {
  args: { children: null },
  render: () => (
    <Menu>
      <Menu.Trigger>◍ Jordan ▾</Menu.Trigger>
      <Menu.Items>
        <Menu.Item>Profile</Menu.Item>
        <Menu.Item>Preferences</Menu.Item>
        <Menu.Item>Sign out</Menu.Item>
      </Menu.Items>
    </Menu>
  ),
};

/** The menu open, with its items in the accessibility tree. */
export const Open: Story = {
  ...UserMenu,
  play: async ({ canvasElement }) => {
    const page = within(canvasElement.ownerDocument.body);
    await userEvent.click(page.getByRole('button', { name: /Jordan/ }));
    await expect(await page.findByRole('menu')).toBeVisible();
  },
};
