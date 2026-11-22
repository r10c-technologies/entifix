import { describe, expect, it } from 'vitest';

import { formatScaled, parseScaled, scaledToDecimal } from './scaled-number.js';

const LOCALES = ['en', 'es', 'es-GT'] as const;

describe('parseScaled', () => {
  it.each([
    ['1,000', 100000],
    ['1.000', 100000],
    ['12,500', 1250000],
    ['12.500.000', 1250000000],
    ['1,000.50', 100050],
    ['1.000,50', 100050],
    ['64,99', 6499],
    ['64.99', 6499],
    ['64,', 6400],
    ['.5', 50],
    ['7', 700],
    ["1'000", 100000],
    [' 1 000,5 ', 100050],
    ['-2,5', -250],
    ['+2', 200],
    ['-0', 0],
  ])('reads %j as %d hundredths, whatever the locale', (text, expected) => {
    for (const locale of LOCALES)
      expect(parseScaled(text, 2, locale)).toBe(expected);
  });

  it.each([
    ['', 2],
    ['abc', 2],
    ['.', 2],
    ['-', 2],
    ['1e3', 2],
    ['64,999,9', 2],
    ['1,00.5', 2],
    ['0,125', 2],
    ['3.5', 0],
    ['3,12345', 3],
    ['9007199254740993', 0],
  ])('refuses %j at scale %d rather than rounding it', (text, scale) => {
    for (const locale of LOCALES)
      expect(parseScaled(text, scale, locale)).toBeUndefined();
  });

  it.each([
    ['3,5', 3500],
    ['3.5', 3500],
    ['0,137', 137],
    ['0.137', 137],
    ['1500', 1500000],
    ['1000,500', 1000500],
  ])('reads %j as %d thousandths, whatever the locale', (text, expected) => {
    for (const locale of LOCALES)
      expect(parseScaled(text, 3, locale)).toBe(expected);
  });

  it('refuses a thousand that could be one, unless the separator is the reader’s decimal one', () => {
    expect(parseScaled('1,500', 3, 'es')).toBe(1500);
    expect(parseScaled('1.500', 3, 'es')).toBeUndefined();
    expect(parseScaled('1.500', 3, 'en')).toBe(1500);
    expect(parseScaled('1,500', 3, 'en')).toBeUndefined();
    expect(parseScaled('1.500', 3, 'es-GT')).toBe(1500);
  });

  it('counts whole things at scale 0', () => {
    expect(parseScaled('1,000', 0, 'en')).toBe(1000);
    expect(parseScaled('12', 0, 'es')).toBe(12);
  });
});

describe('formatScaled', () => {
  it('writes the number with no more decimals than it has', () => {
    expect(formatScaled(3500, 3, 'es')).toBe('3,5');
    expect(formatScaled(3500, 3, 'en')).toBe('3.5');
    expect(formatScaled(3000, 3, 'en')).toBe('3');
    expect(formatScaled(-137, 3, 'en')).toBe('-0.137');
    expect(formatScaled(1234567, 0, 'en')).toBe('1,234,567');
    expect(formatScaled(9007199254740991, 3, 'en')).toBe(
      '9,007,199,254,740.991',
    );
  });

  it('writes text to edit that reads back as the same integer', () => {
    for (const locale of LOCALES)
      for (const scale of [0, 2, 3, 6])
        for (const value of [
          0, 1, -1, 137, 999, 1000, 1255, 12500, 1250000, 9007199254740991,
        ])
          expect(
            parseScaled(
              formatScaled(value, scale, locale, { grouping: false }),
              scale,
              locale,
            ),
          ).toBe(value);
  });

  it('refuses what is not a scaled integer', () => {
    expect(() => scaledToDecimal(3.5, 3)).toThrow(RangeError);
  });
});
