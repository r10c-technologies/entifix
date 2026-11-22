import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import {
  type ControlledQuantityInputProps,
  NumberInput,
  QuantityInput,
} from './index.js';

describe('NumberInput', () => {
  it('is a text input with a numeric keyboard and tabular figures', () => {
    render(<NumberInput aria-label="Weight" defaultValue="1,5" />);
    const input = screen.getByRole('textbox', { name: 'Weight' });
    expect(input).toHaveAttribute('type', 'text');
    expect(input).toHaveAttribute('inputmode', 'decimal');
    expect(input.className).toContain('tabular-nums');
  });

  it('takes another input mode', () => {
    render(<NumberInput aria-label="Units" inputMode="numeric" />);
    expect(screen.getByRole('textbox', { name: 'Units' })).toHaveAttribute(
      'inputmode',
      'numeric',
    );
  });
});

function Quantity({
  initial = 2,
  max,
  onChange = vi.fn(),
  disabled = false,
}: {
  initial?: number;
  max?: number;
  onChange?: (value: number) => void;
  disabled?: boolean;
}) {
  const [value, setValue] = useState(initial);
  return (
    <QuantityInput
      label="Sprocket"
      value={value}
      min={1}
      max={max}
      disabled={disabled}
      onChange={next => {
        setValue(next);
        onChange(next);
      }}
    />
  );
}

describe('QuantityInput', () => {
  it('is a labelled spinbutton with named step buttons out of the Tab order', () => {
    render(<Quantity max={5} />);
    const spin = screen.getByRole('spinbutton', { name: 'Sprocket' });
    expect(spin).toHaveAttribute('aria-valuenow', '2');
    expect(spin).toHaveAttribute('aria-valuemin', '1');
    expect(spin).toHaveAttribute('aria-valuemax', '5');
    for (const name of ['Disminuir Sprocket', 'Aumentar Sprocket']) {
      expect(screen.getByRole('button', { name })).toHaveAttribute(
        'tabindex',
        '-1',
      );
    }
  });

  it('steps with Up and Down, and jumps with Home and End', async () => {
    const user = userEvent.setup();
    render(<Quantity max={5} />);
    const spin = screen.getByRole('spinbutton');
    await user.click(spin);

    await user.keyboard('{ArrowUp}');
    expect(spin).toHaveAttribute('aria-valuenow', '3');
    await user.keyboard('{ArrowDown}{ArrowDown}');
    expect(spin).toHaveAttribute('aria-valuenow', '1');
    await user.keyboard('{ArrowDown}');
    expect(spin).toHaveAttribute('aria-valuenow', '1');
    await user.keyboard('{End}');
    expect(spin).toHaveAttribute('aria-valuenow', '5');
    await user.keyboard('{ArrowUp}');
    expect(spin).toHaveAttribute('aria-valuenow', '5');
    await user.keyboard('{Home}');
    expect(spin).toHaveAttribute('aria-valuenow', '1');
  });

  it('has no End without a maximum, and ignores other keys', async () => {
    const user = userEvent.setup();
    render(<Quantity />);
    const spin = screen.getByRole('spinbutton');
    await user.click(spin);
    await user.keyboard('{End}{Shift}');
    expect(spin).toHaveAttribute('aria-valuenow', '2');
    expect(spin).not.toHaveAttribute('aria-valuemax');
  });

  it('commits what was typed on Enter and on blur, clamped', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<Quantity max={10} onChange={onChange} />);
    const spin = screen.getByRole('spinbutton');

    await user.clear(spin);
    await user.type(spin, '7{Enter}');
    expect(onChange).toHaveBeenLastCalledWith(7);
    await user.clear(spin);
    await user.type(spin, '40');
    await user.tab();
    expect(onChange).toHaveBeenLastCalledWith(10);
    expect(spin).toHaveValue('10');
  });

  it('restores the value when what was typed is not a number', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<Quantity onChange={onChange} />);
    const spin = screen.getByRole('spinbutton');
    await user.clear(spin);
    await user.type(spin, 'x{Enter}');
    expect(spin).toHaveValue('2');
    expect(onChange).not.toHaveBeenCalled();
  });

  it('steps by its buttons, which disable at the bounds', async () => {
    const user = userEvent.setup();
    render(<Quantity initial={1} max={2} />);
    const decrease = screen.getByRole('button', { name: 'Disminuir Sprocket' });
    const increase = screen.getByRole('button', { name: 'Aumentar Sprocket' });
    expect(decrease).toBeDisabled();
    await user.click(increase);
    expect(screen.getByRole('spinbutton')).toHaveAttribute(
      'aria-valuenow',
      '2',
    );
    expect(increase).toBeDisabled();
    await user.click(decrease);
    expect(screen.getByRole('spinbutton')).toHaveAttribute(
      'aria-valuenow',
      '1',
    );
  });

  it('disables everything when disabled', () => {
    render(<Quantity disabled />);
    expect(screen.getByRole('spinbutton')).toBeDisabled();
    for (const button of screen.getAllByRole('button'))
      expect(button).toBeDisabled();
  });
});

describe('QuantityInput in a server form', () => {
  const formData = () =>
    new FormData(screen.getByRole('form', { name: 'cart' }) as HTMLFormElement);

  it('posts the count under its name, as typed, with no script involved', () => {
    render(
      <form aria-label="cart">
        <QuantityInput
          label="Cantidad"
          name="quantity"
          value={2}
          onChange={() => undefined}
        />
      </form>,
    );

    expect(formData().get('quantity')).toBe('2');
  });

  it('server-renders its starting count, so the field posts before hydration', () => {
    const html = renderToStaticMarkup(
      <QuantityInput label="Cantidad" name="quantity" defaultValue={3} />,
    );
    expect(html).toContain('value="3"');
    expect(html).toContain('aria-valuenow="3"');
  });

  it('owns its count when given no value: it steps, clamps and posts what was committed', async () => {
    const user = userEvent.setup();
    render(
      <form aria-label="cart">
        <QuantityInput
          label="Cantidad"
          name="quantity"
          defaultValue={2}
          min={1}
          max={5}
        />
      </form>,
    );
    const spin = screen.getByRole('spinbutton', { name: 'Cantidad' });

    await user.click(screen.getByRole('button', { name: 'Aumentar Cantidad' }));
    expect(spin).toHaveAttribute('aria-valuenow', '3');
    expect(formData().get('quantity')).toBe('3');

    await user.clear(spin);
    await user.type(spin, '40');
    await user.tab();
    expect(spin).toHaveAttribute('aria-valuenow', '5');
    expect(formData().get('quantity')).toBe('5');

    await user.click(spin);
    await user.keyboard('{Home}');
    expect(formData().get('quantity')).toBe('1');
    expect(
      screen.getByRole('button', { name: 'Disminuir Cantidad' }),
    ).toBeDisabled();
  });

  it('starts at its minimum without a default, and still reports each commit', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<QuantityInput label="Cantidad" min={1} onChange={onChange} />);
    const spin = screen.getByRole('spinbutton');
    expect(spin).toHaveAttribute('aria-valuenow', '1');

    await user.click(spin);
    await user.keyboard('{ArrowUp}');
    expect(onChange).toHaveBeenLastCalledWith(2);
    await user.keyboard('{ArrowDown}{ArrowDown}');
    expect(onChange).toHaveBeenCalledTimes(2);
  });

  it('refuses half of the controlled pair at compile time', () => {
    // @ts-expect-error a value with no onChange is a field nobody can change
    const valueOnly = <QuantityInput label="Cantidad" value={2} />;
    const both = (
      // @ts-expect-error a field is either controlled or seeded, never both
      <QuantityInput
        label="x"
        value={2}
        defaultValue={3}
        onChange={() => undefined}
      />
    );
    expect([valueOnly, both]).toHaveLength(2);
  });
});

function Measure({
  initial = 3500,
  ...props
}: Partial<Omit<ControlledQuantityInputProps, 'value'>> & {
  initial?: number;
}) {
  const [value, setValue] = useState(initial);
  return (
    <>
      <QuantityInput
        label="Cable"
        scale={3}
        {...props}
        value={value}
        onChange={next => {
          setValue(next);
          props.onChange?.(next);
        }}
      />
      <button type="button" onClick={() => setValue(2250)}>
        reset
      </button>
    </>
  );
}

describe('QuantityInput with a scale', () => {
  const spin = () => screen.getByRole('spinbutton', { name: 'Cable' });

  it('shows and announces the decimal, beside its unit', () => {
    render(<Measure min={1000} max={9000} step={500} unit="M" />);
    expect(spin()).toHaveValue('3,5');
    expect(spin()).toHaveAttribute('aria-valuenow', '3.5');
    expect(spin()).toHaveAttribute('aria-valuetext', '3,5 M');
    expect(spin()).toHaveAttribute('aria-valuemin', '1');
    expect(spin()).toHaveAttribute('aria-valuemax', '9');
    expect(spin()).toHaveAttribute('inputmode', 'decimal');
    expect(spin()).toHaveAccessibleDescription('M');
    expect(spin()).not.toHaveAttribute('aria-invalid');
  });

  it.each([
    ['0,5', 500],
    ['12', 12000],
    ['3,7', 3700],
  ])('keeps %j as typed, reporting and marking it', async (typed, stored) => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<Measure min={1000} max={9000} step={500} onChange={onChange} />);

    await user.clear(spin());
    await user.type(spin(), typed);
    await user.tab();

    expect(spin()).toHaveValue(typed);
    expect(onChange).toHaveBeenLastCalledWith(stored);
    expect(spin()).toHaveAttribute('aria-invalid', 'true');
  });

  it('reports text that is no number as NaN, never the quantity before it', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<Measure onChange={onChange} />);

    await user.clear(spin());
    expect(onChange).toHaveBeenLastCalledWith(Number.NaN);
    expect(spin()).not.toHaveAttribute('aria-valuetext');
    await user.type(spin(), 'x');
    expect(spin()).toHaveValue('x');
    expect(spin()).not.toHaveAttribute('aria-valuenow');
    expect(spin()).toHaveAttribute('aria-valuetext', 'x');
    expect(spin()).toHaveAttribute('aria-invalid', 'true');
  });

  it('steps onto the grid, inside the bounds', async () => {
    const user = userEvent.setup();
    render(<Measure initial={3700} min={1000} max={4500} step={500} />);

    await user.click(screen.getByRole('button', { name: 'Aumentar Cable' }));
    expect(spin()).toHaveValue('4');
    await user.click(spin());
    await user.keyboard('{ArrowUp}{ArrowUp}');
    expect(spin()).toHaveValue('4,5');
    await user.keyboard('{Home}');
    expect(spin()).toHaveValue('1');
    expect(
      screen.getByRole('button', { name: 'Disminuir Cable' }),
    ).toBeDisabled();
    await user.keyboard('{End}{ArrowDown}');
    expect(spin()).toHaveValue('4');
  });

  it('steps a whole unit when no step is stated, and has no End without a maximum', async () => {
    const user = userEvent.setup();
    render(<Measure initial={3500} />);

    await user.click(screen.getByRole('button', { name: 'Disminuir Cable' }));
    expect(spin()).toHaveValue('3');
    await user.click(spin());
    await user.keyboard('{End}');
    expect(spin()).toHaveValue('3');
  });

  it('steps from text that is no number to the minimum', async () => {
    const user = userEvent.setup();
    render(<Measure min={1000} />);

    await user.clear(spin());
    await user.keyboard('{ArrowUp}');
    expect(spin()).toHaveValue('1');
    await user.clear(spin());
    await user.keyboard('{ArrowDown}');
    expect(spin()).toHaveValue('1');
  });

  it('follows a value changed from outside', async () => {
    const user = userEvent.setup();
    render(<Measure />);
    await user.click(screen.getByRole('button', { name: 'reset' }));
    expect(spin()).toHaveValue('2,25');
  });

  it('shows nothing to edit for a value that is no scaled integer', () => {
    render(<Measure initial={Number.NaN} />);
    expect(spin()).toHaveValue('');
  });

  it('carries the caller’s refusal', () => {
    render(
      <>
        <p id="why">Not enough in stock</p>
        <Measure invalid aria-describedby="why" />
      </>,
    );
    expect(spin()).toHaveAttribute('aria-invalid', 'true');
    expect(spin()).toHaveAccessibleDescription('Not enough in stock');
  });

  it('is whole units at scale 0, and still never clamps', async () => {
    const user = userEvent.setup();
    render(<Measure scale={0} initial={2} max={5} />);

    expect(spin()).toHaveAttribute('inputmode', 'numeric');
    await user.clear(spin());
    await user.type(spin(), '99');
    await user.tab();
    expect(spin()).toHaveValue('99');
    expect(
      screen.getByRole('button', { name: 'Aumentar Cable' }),
    ).toBeDisabled();
  });

  it('can be disabled', () => {
    render(<Measure disabled />);
    expect(spin()).toBeDisabled();
  });

  it('posts the decimal text without a script, and owns its value with one', async () => {
    const inForm = (
      <form>
        <QuantityInput
          label="Cable"
          name="quantity"
          scale={3}
          defaultValue={3500}
        />
      </form>
    );
    const html = renderToStaticMarkup(inForm);
    expect(html).toContain('value="3,5"');
    expect(html).toContain('name="quantity"');

    const { container } = render(inForm);
    await userEvent.clear(spin());
    await userEvent.type(spin(), '4,25');
    expect(
      new FormData(container.querySelector('form') as HTMLFormElement).get(
        'quantity',
      ),
    ).toBe('4,25');
  });

  it('starts at its minimum when given no value', () => {
    render(<QuantityInput label="Cable" scale={3} min={1500} />);
    expect(spin()).toHaveValue('1,5');
  });
});
