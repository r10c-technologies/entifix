import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { expect, within } from 'storybook/test';

import { ScaledInput, ScaledValue } from './index.js';

const meta: Meta<typeof ScaledValue> = {
  title: 'Atoms/Scaled',
  component: ScaledValue,
  tags: ['autodocs'],
};

export default meta;
type Story = StoryObj<typeof ScaledValue>;

/** Stored integers, read as the decimals they stand for. */
export const Measures: Story = {
  render: () => (
    <dl className="grid grid-cols-2 gap-x-m gap-y-2xs text-step-sm">
      <dt>Metres, es</dt>
      <dd>
        <ScaledValue value={3500} scale={3} unit="M" locale="es" />
      </dd>
      <dt>Metres, en</dt>
      <dd>
        <ScaledValue value={3500} scale={3} unit="M" locale="en" />
      </dd>
      <dt>Pieces</dt>
      <dd>
        <ScaledValue value={12} scale={0} unit="UN" locale="en" />
      </dd>
    </dl>
  ),
  play: async ({ canvasElement }) => {
    await expect(canvasElement.textContent).not.toMatch(/3500/);
  },
};

function Editing() {
  const [value, setValue] = useState('3500');
  return (
    <div className="flex flex-col gap-s">
      <ScaledInput
        aria-label="Length"
        value={value}
        scale={3}
        unit="M"
        locale="es"
        onChange={setValue}
      />
      <ScaledInput
        aria-label="Length without a unit"
        value=""
        scale={undefined}
        locale="es"
        onChange={setValue}
      />
    </div>
  );
}

/** Edited as the decimal; it waits, saying so, while there is no unit. */
export const Edited: Story = {
  render: () => <Editing />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole('textbox', { name: 'Length' })).toHaveValue(
      '3,5',
    );
    await expect(
      canvas.getByRole('textbox', { name: 'Length without a unit' }),
    ).toBeDisabled();
  },
};
