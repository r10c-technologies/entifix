import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, userEvent, within } from 'storybook/test';

import { indicatorContrast } from '../../../../.storybook/indicator.js';
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

/**
 * The item under the keyboard wears the focus ring — 3:1 against the panel —
 * rather than a background swap of about 1.05:1 (ADR 0025).
 */
export const Keyboard: Story = {
  ...UserMenu,
  play: async ({ canvasElement }) => {
    const page = within(canvasElement.ownerDocument.body);
    await userEvent.tab();
    await userEvent.keyboard('{Enter}');
    const menu = await page.findByRole('menu');
    await userEvent.keyboard('{ArrowDown}');
    const active = page.getByRole('menuitem', { name: 'Preferences' });
    await expect(active).toHaveAttribute('data-focus');
    await expect(indicatorContrast(active, menu)).toBeGreaterThanOrEqual(3);
  },
};

/**
 * An account menu's appearance choices, both groups open: a `menuitemradio`
 * per option, the one in effect checked and marked.
 */
export const AppearanceGroups: Story = {
  render: () => (
    <Menu>
      <Menu.Trigger>◕ Ada</Menu.Trigger>
      <Menu.Items>
        <Menu.Group label="Tema">
          <Menu.Radio checked>Aurora</Menu.Radio>
          <Menu.Radio checked={false}>Medianoche</Menu.Radio>
        </Menu.Group>
        <Menu.Group label="Densidad">
          <Menu.Radio checked={false}>Cómoda</Menu.Radio>
          <Menu.Radio checked>Compacta</Menu.Radio>
        </Menu.Group>
      </Menu.Items>
    </Menu>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole('button', { name: /Ada/ }));
    const page = within(canvasElement.ownerDocument.body);
    await expect(page.getAllByRole('group')).toHaveLength(2);
    await expect(
      page.getByRole('menuitemradio', { name: 'Aurora' }),
    ).toHaveAttribute('aria-checked', 'true');
  },
};
