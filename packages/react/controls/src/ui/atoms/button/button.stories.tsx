import type { Meta, StoryObj } from '@storybook/react-vite';

import { Button } from './button.js';
import { SubmitButton } from './submit-button.js';

const meta = {
  title: 'Atoms/Button',
  component: Button,
  tags: ['autodocs'],
  args: { children: 'Save changes' },
  argTypes: {
    variant: { control: 'select', options: ['primary', 'secondary', 'ghost'] },
    size: { control: 'select', options: ['sm', 'md', 'lg'] },
  },
} satisfies Meta<typeof Button>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Primary: Story = { args: { variant: 'primary' } };
export const Secondary: Story = { args: { variant: 'secondary' } };
export const Ghost: Story = { args: { variant: 'ghost' } };
export const Large: Story = { args: { size: 'lg' } };

/** A server-rendered form's submit: no client code, posts with scripting off. */
export const Submit: StoryObj = {
  render: () => (
    <form onSubmit={event => event.preventDefault()} className="flex gap-xs">
      <SubmitButton>Save</SubmitButton>
      <SubmitButton variant="secondary">Save draft</SubmitButton>
    </form>
  ),
};
