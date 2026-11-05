import type { ComponentPropsWithoutRef } from 'react';

import { cn } from '../../utils/cn.js';
import { formatMoney, type MoneyUnit } from './money-math.js';

export interface MoneyProps extends Omit<
  ComponentPropsWithoutRef<'span'>,
  'children'
> {
  amount: number;
  /** ISO 4217, e.g. `GTQ`. */
  currency: string;
  /** Whether `amount` counts minor units (cents) or major ones. */
  unit: MoneyUnit;
  /** The reader's locale; a client caller passes `useLocale()`. */
  locale: string;
}

/**
 * An amount of money, formatted in the reader's locale with its currency.
 * `unit: 'minor'` divides by the currency's own minor-unit count, so JPY and
 * KWD are right too. Tabular figures, so a column of prices aligns on the
 * digit. Server-safe.
 */
export function Money({
  amount,
  currency,
  unit,
  locale,
  className,
  ...props
}: MoneyProps) {
  return (
    <span
      className={cn('whitespace-nowrap tabular-nums', className)}
      {...props}
    >
      {formatMoney(amount, currency, unit, locale)}
    </span>
  );
}
