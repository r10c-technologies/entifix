import type { Meta, StoryObj } from '@storybook/react-vite';

import { DemoBox } from '../_demo.js';
import { Switcher } from './switcher.js';

const meta = {
  title: 'Layout/Switcher',
  component: Switcher,
  tags: ['autodocs'],
  parameters: { layout: 'padded' },
  render: args => (
    <Switcher {...args}>
      <DemoBox>One</DemoBox>
      <DemoBox>Two</DemoBox>
      <DemoBox>Three</DemoBox>
    </Switcher>
  ),
} satisfies Meta<typeof Switcher>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = { args: { threshold: '30rem' } };
export const EarlySwitch: Story = { args: { threshold: '48rem' } };
