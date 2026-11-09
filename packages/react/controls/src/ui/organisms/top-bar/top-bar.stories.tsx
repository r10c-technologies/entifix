import type { Meta, StoryObj } from '@storybook/react-vite';

import { Menu } from '../../molecules/menu/index.js';
import { TopBar } from './top-bar.js';

const meta = {
  title: 'Organisms/TopBar',
  component: TopBar,
  tags: ['autodocs'],
} satisfies Meta<typeof TopBar>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: () => (
    <TopBar>
      <TopBar.Brand>◈ Acme</TopBar.Brand>
      <TopBar.Context>back office</TopBar.Context>
      <TopBar.Actions>
        <Menu>
          <Menu.Trigger>◍ Jordan ▾</Menu.Trigger>
          <Menu.Items>
            <Menu.Item>Preferences</Menu.Item>
            <Menu.Item>Sign out</Menu.Item>
          </Menu.Items>
        </Menu>
      </TopBar.Actions>
    </TopBar>
  ),
};

/** The stream dropped and is retrying: paused, with Reconnect. */
export const Reconnecting: Story = {
  render: () => (
    <TopBar connection="reconnecting" onReconnect={() => undefined}>
      <TopBar.Brand>◈ Acme</TopBar.Brand>
    </TopBar>
  ),
};

/** The stream gave up: stopped, with Reconnect. */
export const Stopped: Story = {
  render: () => (
    <TopBar connection="closed" onReconnect={() => undefined}>
      <TopBar.Brand>◈ Acme</TopBar.Brand>
    </TopBar>
  ),
};
