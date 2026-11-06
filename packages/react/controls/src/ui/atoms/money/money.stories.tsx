import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { expect, within } from 'storybook/test';

import { Money, MoneyInput } from './index.js';

const meta: Meta<typeof Money> = {
  title: 'Atoms/Money',
  component: Money,
  tags: ['autodocs'],
};

export default meta;
type Story = StoryObj<typeof Money>;

/** Stored minor units, printed in each locale's own way; never the raw number. */
export const Amounts: Story = {
  render: () => (
    <dl className="grid grid-cols-2 gap-x-m gap-y-2xs text-step-sm">
      <dt>GTQ, es</dt>
      <dd>
        <Money amount={6499} currency="GTQ" unit="minor" locale="es" />
      </dd>
      <dt>GTQ, en</dt>
      <dd>
        <Money amount={6499} currency="GTQ" unit="minor" locale="en" />
      </dd>
      <dt>JPY (no minor units)</dt>
      <dd>
        <Money amount={6499} currency="JPY" unit="minor" locale="en" />
      </dd>
      <dt>KWD (three)</dt>
      <dd>
        <Money amount={6499} currency="KWD" unit="minor" locale="en" />
      </dd>
    </dl>
  ),
  play: async ({ canvasElement }) => {
    await expect(canvasElement.textContent).not.toMatch(/6499(?!\d)/);
    await expect(within(canvasElement).getByText(/64,99/)).toBeInTheDocument();
  },
};

function Editor() {
  const [value, setValue] = useState('6499');
  return (
    <div className="flex flex-col gap-3xs">
      <label htmlFor="price">Price</label>
      <MoneyInput
        id="price"
        value={value}
        onChange={setValue}
        currency="GTQ"
        unit="minor"
        locale="es"
      />
    </div>
  );
}

/** Edited in major units, written back as minor ones. */
export const Input: Story = { render: () => <Editor /> };
