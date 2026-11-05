import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';

import {
  currencyOf,
  formatMoney,
  fractionDigits,
  fromMajorUnits,
  Money,
  MoneyInput,
  toMajorUnits,
} from './index.js';

describe('money math', () => {
  it('reads each currency’s minor units from Intl', () => {
    expect(fractionDigits('GTQ')).toBe(2);
    expect(fractionDigits('JPY')).toBe(0);
    expect(fractionDigits('KWD')).toBe(3);
  });

  it('converts between stored and major units both ways', () => {
    expect(toMajorUnits(6499, 'GTQ', 'minor')).toBe(64.99);
    expect(toMajorUnits(6499, 'JPY', 'minor')).toBe(6499);
    expect(toMajorUnits(1250, 'KWD', 'minor')).toBe(1.25);
    expect(toMajorUnits(64.99, 'GTQ', 'major')).toBe(64.99);
    expect(fromMajorUnits(64.99, 'GTQ', 'minor')).toBe(6499);
    expect(fromMajorUnits(64.999, 'GTQ', 'major')).toBe(65);
  });

  it('formats 6499 minor GTQ as 64.99 or 64,99 with its currency, never 6499', () => {
    const en = formatMoney(6499, 'GTQ', 'minor', 'en');
    const es = formatMoney(6499, 'GTQ', 'minor', 'es');
    expect(en).toMatch(/64\.99/);
    expect(es).toMatch(/64,99/);
    for (const text of [en, es]) {
      expect(text).toMatch(/Q|GTQ/);
      expect(text).not.toMatch(/6499/);
    }
  });

  it('takes a fixed currency, or the record’s own member', () => {
    expect(currencyOf({ unit: 'minor', currency: 'USD' }, undefined)).toBe(
      'USD',
    );
    const fromMember = { unit: 'minor', currencyMember: 'currency' } as const;
    expect(currencyOf(fromMember, { currency: 'GTQ' })).toBe('GTQ');
    expect(currencyOf(fromMember, { currency: '' })).toBeUndefined();
    expect(currencyOf(fromMember, { currency: 7 })).toBeUndefined();
    expect(currencyOf(fromMember, undefined)).toBeUndefined();
  });
});

describe('Money', () => {
  it('renders in the reader’s locale, with tabular figures', () => {
    render(<Money amount={6499} currency="GTQ" unit="minor" locale="es" />);
    const money = screen.getByText(/64,99/);
    expect(money.className).toContain('tabular-nums');
  });
});

function Controlled({ initial = '6499', onChange = vi.fn() }) {
  const [value, setValue] = useState(initial);
  return (
    <>
      <MoneyInput
        aria-label="Price"
        value={value}
        currency="GTQ"
        unit="minor"
        locale="es"
        onChange={next => {
          setValue(next);
          onChange(next);
        }}
      />
      <button type="button" onClick={() => setValue('100')}>
        reset
      </button>
    </>
  );
}

describe('MoneyInput', () => {
  it('shows the stored minor amount in major units, in the locale’s separator', () => {
    render(<Controlled />);
    expect(screen.getByRole('textbox', { name: 'Price' })).toHaveValue('64,99');
  });

  it('writes back minor units as typed, keeping the text as typed', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<Controlled initial="" onChange={onChange} />);
    const input = screen.getByRole('textbox', { name: 'Price' });

    await user.type(input, '12,5');
    expect(input).toHaveValue('12,5');
    expect(onChange).toHaveBeenLastCalledWith('1250');

    await user.clear(input);
    expect(onChange).toHaveBeenLastCalledWith('');
    await user.type(input, '1.234,56');
    expect(onChange).toHaveBeenLastCalledWith('123456');
    await user.clear(input);
    await user.type(input, '7');
    expect(onChange).toHaveBeenLastCalledWith('700');
  });

  it('passes text that is not a number through, for validation to refuse', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<Controlled initial="" onChange={onChange} />);
    await user.type(screen.getByRole('textbox', { name: 'Price' }), 'abc');
    expect(onChange).toHaveBeenLastCalledWith('abc');
  });

  it('follows a value changed from outside', async () => {
    const user = userEvent.setup();
    render(<Controlled />);
    await user.click(screen.getByRole('button', { name: 'reset' }));
    expect(screen.getByRole('textbox', { name: 'Price' })).toHaveValue('1,00');
  });

  it('shows a stored value that is not a number as it is', () => {
    render(<Controlled initial="oops" />);
    expect(screen.getByRole('textbox', { name: 'Price' })).toHaveValue('oops');
  });

  it('asks for whole numbers in a currency with no minor units', () => {
    render(
      <MoneyInput
        aria-label="Yen"
        value="500"
        currency="JPY"
        unit="minor"
        locale="en"
        onChange={() => undefined}
      />,
    );
    const input = screen.getByRole('textbox', { name: 'Yen' });
    expect(input).toHaveAttribute('inputmode', 'numeric');
    expect(input).toHaveValue('500');
  });
});
