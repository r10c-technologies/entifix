import type { EntityFieldDescriptor, ScaledFormat } from '@entifix/core';
import { render, renderHook, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { CellValue, useValueText } from '../cell-value/cell-value.js';
import { FieldControl } from '../field-control/field-control.js';
import { ScaledInput, ScaledValue, scaleOf } from './index.js';

const BY_UNIT: ScaledFormat = {
  unitMember: 'unit',
  units: { UN: 0, M: 3 },
};

const measured = (scaled: ScaledFormat): EntityFieldDescriptor => ({
  name: 'quantity',
  key: 'quantity',
  label: 'Quantity',
  type: 'number',
  sortable: true,
  filterable: true,
  order: 0,
  readonly: false,
  required: false,
  linkLabelProperty: 'name',
  linkSearchProperty: 'name',
  linkSerialization: 'id',
  resetOnClone: false,
  scaled,
});

describe('scaleOf', () => {
  it('is the fixed scale, or the one of the record’s unit', () => {
    expect(scaleOf({ scale: 2 }, undefined)).toEqual({ scale: 2 });
    expect(scaleOf(BY_UNIT, { unit: 'M' })).toEqual({ scale: 3, unit: 'M' });
    expect(scaleOf(BY_UNIT, { unit: 'UN' })).toEqual({ scale: 0, unit: 'UN' });
  });

  it('is nothing without a unit the member declares', () => {
    for (const record of [undefined, {}, { unit: 3 }, { unit: 'toString' }])
      expect(scaleOf(BY_UNIT, record)).toBeUndefined();
  });
});

describe('ScaledValue', () => {
  it('reads as the decimal, with its unit on the same line', () => {
    const { container } = render(
      <ScaledValue value={3500} scale={3} unit="M" locale="es" />,
    );
    expect(container.textContent).toBe('3,5\u00a0M');
  });

  it('reads alone when it has no unit', () => {
    const { container } = render(
      <ScaledValue value={3500} scale={3} locale="en" />,
    );
    expect(container.textContent).toBe('3.5');
  });
});

describe('a scaled CellValue', () => {
  it.each([3500, '3500'])('reads %j by the record’s unit', value => {
    const { container } = render(
      <CellValue
        value={value}
        descriptor={measured(BY_UNIT)}
        record={{ unit: 'M' }}
      />,
    );
    expect(container.textContent).toBe('3,5\u00a0M');
  });

  it('names the unit from the host’s catalog when the member says where', () => {
    const { container } = render(
      <CellValue
        value={3500}
        descriptor={measured({ ...BY_UNIT, unitLabelKey: 'host:units' })}
        record={{ unit: 'M' }}
      />,
    );
    expect(container.textContent).toContain('units.M');
  });

  it('stays the number it is without a unit, or when it is no integer', () => {
    const { container, rerender } = render(
      <CellValue value={12} descriptor={measured(BY_UNIT)} record={{}} />,
    );
    expect(container.textContent).toBe('12');
    rerender(<CellValue value={1.5} descriptor={measured({ scale: 3 })} />);
    expect(container.textContent).toBe('1,5');
  });

  it('reads in words at a fixed scale, which needs no record', () => {
    const { result } = renderHook(() => useValueText());
    expect(result.current(3500, measured({ scale: 3 }))).toBe('3,5');
    expect(result.current(1.5, measured({ scale: 3 }))).toBe('1,5');
  });
});

function Field({
  unit: initialUnit = 'M',
  initial = '',
  scaled = BY_UNIT,
  onChange = vi.fn(),
}: {
  unit?: string;
  initial?: string;
  scaled?: ScaledFormat;
  onChange?: (value: string) => void;
}) {
  const [value, setValue] = useState(initial);
  const [unit, setUnit] = useState(initialUnit);
  return (
    <>
      <FieldControl
        descriptor={measured(scaled)}
        value={value}
        record={{ unit }}
        onChange={next => {
          setValue(next);
          onChange(next);
        }}
      />
      <button type="button" onClick={() => setUnit('UN')}>
        pieces
      </button>
      <button type="button" onClick={() => setUnit('M')}>
        metres
      </button>
      <button type="button" onClick={() => setUnit('')}>
        none
      </button>
      <button type="button" onClick={() => setValue('1250')}>
        reset
      </button>
    </>
  );
}

const field = () => screen.getByRole('textbox');

describe('a scaled FieldControl', () => {
  it('shows the decimal and writes back the integer', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<Field initial="3500" onChange={onChange} />);

    expect(field()).toHaveValue('3,5');
    expect(field()).toHaveAttribute('inputmode', 'decimal');
    expect(field()).toHaveAccessibleDescription('M');
    await user.clear(field());
    expect(onChange).toHaveBeenLastCalledWith('');
    await user.type(field(), '0,137');
    expect(field()).toHaveValue('0,137');
    expect(onChange).toHaveBeenLastCalledWith('137');
  });

  it('hands on what it cannot read as text no number parser accepts', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<Field unit="UN" onChange={onChange} />);

    expect(field()).toHaveAttribute('inputmode', 'numeric');
    await user.type(field(), '3.5');
    // `Number('3.5')` would pass validation and be stored as three and a half.
    expect(Number(onChange.mock.lastCall?.[0])).toBeNaN();
    expect(field()).toHaveValue('3.5');
  });

  it('shows again what an earlier draft could not read, as it was typed', () => {
    render(<Field unit="UN" initial={'\u20603.5'} />);
    expect(field()).toHaveValue('3.5');
  });

  it('waits for a unit, saying so', () => {
    render(<Field unit="" />);
    expect(field()).toBeDisabled();
    expect(field()).toHaveAccessibleDescription('Elige primero una unidad');
  });

  it('keeps the meaning of what was typed when the unit changes', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<Field onChange={onChange} />);

    await user.type(field(), '3');
    expect(onChange).toHaveBeenLastCalledWith('3000');
    await user.click(screen.getByRole('button', { name: 'pieces' }));
    expect(onChange).toHaveBeenLastCalledWith('3');
    expect(field()).toHaveValue('3');
    await user.click(screen.getByRole('button', { name: 'none' }));
    expect(Number(onChange.mock.lastCall?.[0])).toBeNaN();
    await user.click(screen.getByRole('button', { name: 'metres' }));
    expect(onChange).toHaveBeenLastCalledWith('3000');
  });

  it('writes nothing when the unit changes and the integer does not', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<Field onChange={onChange} />);

    await user.type(field(), '0');
    onChange.mockClear();
    await user.click(screen.getByRole('button', { name: 'pieces' }));
    expect(onChange).not.toHaveBeenCalled();
  });

  it('only shows a stored value again when the unit changes', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<Field initial="3500" onChange={onChange} />);

    await user.click(screen.getByRole('button', { name: 'pieces' }));
    expect(field()).toHaveValue('3500');
    expect(onChange).not.toHaveBeenCalled();
  });

  it('follows a value changed from outside', async () => {
    const user = userEvent.setup();
    render(<Field />);
    await user.click(screen.getByRole('button', { name: 'reset' }));
    expect(field()).toHaveValue('1,25');
  });

  it('keeps the caller’s description beside the unit', () => {
    render(
      <>
        <p id="why">Too little</p>
        <ScaledInput
          aria-describedby="why"
          value="1"
          scale={0}
          unit="UN"
          locale="es"
          onChange={() => undefined}
        />
      </>,
    );
    expect(field()).toHaveAccessibleDescription('Too little UN');
  });

  it('describes nothing at a fixed scale with no unit', () => {
    render(<Field scaled={{ scale: 2 }} initial="250" />);
    expect(field()).toHaveValue('2,5');
    expect(field()).not.toHaveAttribute('aria-describedby');
  });
});
