import type { Meta, StoryObj } from '@storybook/react-vite';
import type { CSSProperties } from 'react';
import { useState } from 'react';
import { expect, userEvent, within } from 'storybook/test';

import { undersizedTargets } from '../../../../.storybook/target-size.js';
import { NumberInput } from './number-input.js';
import { QuantityInput } from './quantity-input.js';

const meta: Meta<typeof NumberInput> = {
  title: 'Atoms/NumberInput',
  component: NumberInput,
  tags: ['autodocs'],
};

export default meta;
type Story = StoryObj<typeof NumberInput>;

export const Default: Story = {
  render: () => (
    <div className="flex flex-col gap-3xs">
      <label htmlFor="weight">Weight (kg)</label>
      <NumberInput id="weight" defaultValue="1,5" />
    </div>
  ),
};

function Quantity() {
  const [value, setValue] = useState(2);
  return (
    <QuantityInput
      label="Sprocket"
      value={value}
      min={1}
      max={9}
      onChange={setValue}
    />
  );
}

/** A spinbutton: Up and Down step it, Home and End jump to its bounds. */
export const Quantities: Story = {
  render: () => <Quantity />,
  play: async ({ canvasElement }) => {
    const spin = within(canvasElement).getByRole('spinbutton', {
      name: 'Sprocket',
    });
    await userEvent.click(spin);
    await userEvent.keyboard('{ArrowUp}');
    await expect(spin).toHaveAttribute('aria-valuenow', '3');
    await userEvent.keyboard('{End}');
    await expect(spin).toHaveAttribute('aria-valuenow', '9');
  },
};

/** Its − and + reach a host's raised floor. */
export const TouchFloor: Story = {
  render: () => (
    <div
      data-testid="touch"
      style={{ '--target-min': '44px' } as CSSProperties}
    >
      <Quantity />
    </div>
  ),
  play: async ({ canvasElement }) => {
    const touch = canvasElement.querySelector('[data-testid="touch"]')!;
    await expect(undersizedTargets(touch, 44)).toEqual([]);
  },
};

/**
 * Inside a Server Action form: seeded with `defaultValue` and no handler, so
 * a server component renders it and the count posts under `name`.
 */
export const InAServerForm: Story = {
  render: () => (
    <form aria-label="Cart line" onSubmit={event => event.preventDefault()}>
      <QuantityInput
        label="Sprocket"
        name="quantity"
        defaultValue={2}
        min={1}
        max={9}
      />
    </form>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const spin = canvas.getByRole('spinbutton', { name: 'Sprocket' });
    await userEvent.click(spin);
    await userEvent.keyboard('{ArrowUp}');
    const form = canvas.getByRole('form', {
      name: 'Cart line',
    }) as HTMLFormElement;
    await expect(new FormData(form).get('quantity')).toBe('3');
  },
};

function Measure() {
  const [value, setValue] = useState(3500);
  return (
    <QuantityInput
      label="Cable"
      scale={3}
      unit="M"
      min={1000}
      max={9000}
      step={500}
      value={value}
      onChange={setValue}
    />
  );
}

/**
 * With a `scale`: the stored 3500 is 3.5, and an entry off the step stays as
 * typed, marked invalid rather than sold as something else.
 */
export const Measured: Story = {
  render: () => <Measure />,
  play: async ({ canvasElement }) => {
    const spin = within(canvasElement).getByRole('spinbutton', {
      name: 'Cable',
    });
    await expect(spin).toHaveAttribute('aria-valuenow', '3.5');
    await userEvent.clear(spin);
    await userEvent.type(spin, '3,7');
    await expect(spin).toHaveValue('3,7');
    await expect(spin).toHaveAttribute('aria-invalid', 'true');
  },
};
