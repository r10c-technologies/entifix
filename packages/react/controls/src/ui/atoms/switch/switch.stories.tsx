import type { Meta, StoryObj } from '@storybook/react-vite';

import { Switch } from './switch.js';

const meta: Meta = {
  title: 'Atoms/Switch',
  component: Switch,
  tags: ['autodocs'],
};

export default meta;
type Story = StoryObj;

export const States: Story = {
  render: () => (
    <div className="flex flex-col gap-s">
      <Switch>Email notifications</Switch>
      <Switch defaultChecked>Show retired items</Switch>
      <Switch disabled>Unavailable</Switch>
    </div>
  ),
};
