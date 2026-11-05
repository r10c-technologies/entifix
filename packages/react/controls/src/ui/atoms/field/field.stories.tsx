import type { Meta, StoryObj } from '@storybook/react-vite';

import { Checkbox } from './checkbox.js';
import { Select, TextInput } from './field.js';

const meta: Meta = {
  title: 'Atoms/Field',
  component: TextInput,
  tags: ['autodocs'],
};

export default meta;
type Story = StoryObj;

/** The bare inputs every form control composes, each with its own label. */
export const Inputs: Story = {
  render: () => (
    <div className="flex flex-col gap-s">
      <label className="flex flex-col gap-3xs">
        Name
        <TextInput defaultValue="Sprocket" />
      </label>
      <label className="flex flex-col gap-3xs">
        Status
        <Select defaultValue="active">
          <option value="active">Active</option>
          <option value="retired">Retired</option>
        </Select>
      </label>
      <label className="flex flex-col gap-3xs">
        Disabled
        <TextInput disabled defaultValue="Read only" />
      </label>
    </div>
  ),
};

export const Checkboxes: Story = {
  render: () => (
    <div className="flex flex-col gap-s">
      <Checkbox label="Unchecked" />
      <Checkbox label="Checked" defaultChecked />
      <Checkbox label="Some rows selected" indeterminate />
      <Checkbox label="Disabled" disabled />
    </div>
  ),
};
