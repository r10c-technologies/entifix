import type { MoneyFormat } from '@entifix/core';

export type MoneyUnit = MoneyFormat['unit'];

/**
 * How many minor units a currency has, as `Intl` resolves it: 2 for GTQ and
 * USD, 0 for JPY, 3 for KWD. Read from the platform rather than a table, so a
 * currency nobody here thought of is still right.
 */
export function fractionDigits(currency: string): number {
  // Always set for `style: 'currency'`; the fallback only satisfies the type.
  /* v8 ignore next */
  return (
    new Intl.NumberFormat('en', {
      style: 'currency',
      currency,
    }).resolvedOptions().maximumFractionDigits ?? 2
  );
}

/** The amount in major units (64.99), whichever unit it is stored in. */
export function toMajorUnits(
  amount: number,
  currency: string,
  unit: MoneyUnit,
): number {
  return unit === 'major' ? amount : amount / 10 ** fractionDigits(currency);
}

/** A major-unit amount back in the unit it is stored in, rounded to it. */
export function fromMajorUnits(
  major: number,
  currency: string,
  unit: MoneyUnit,
): number {
  const digits = fractionDigits(currency);
  return unit === 'major'
    ? Number(major.toFixed(digits))
    : Math.round(major * 10 ** digits);
}

/**
 * The amount as the reader's locale writes money: `Q64.99` in `en`, `64,99 GTQ`
 * or similar in `es`. Never the bare stored number — a till once printed
 * 6499 GTQ for 64,99.
 */
export function formatMoney(
  amount: number,
  currency: string,
  unit: MoneyUnit,
  locale: string,
): string {
  return new Intl.NumberFormat(locale, { style: 'currency', currency }).format(
    toMajorUnits(amount, currency, unit),
  );
}

/** The currency a money member reads in: fixed, or the record's own member. */
export function currencyOf(
  money: MoneyFormat,
  record: Readonly<Record<string, unknown>> | undefined,
): string | undefined {
  if (money.currency !== undefined) return money.currency;
  const value = record?.[money.currencyMember];
  return typeof value === 'string' && value !== '' ? value : undefined;
}
