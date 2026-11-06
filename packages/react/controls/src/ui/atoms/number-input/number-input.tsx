import type { ComponentPropsWithoutRef } from 'react';

import { cn } from '../../utils/cn.js';
import { TextInput } from '../field/field.js';

export type NumberInputProps = Omit<ComponentPropsWithoutRef<'input'>, 'type'>;

/**
 * A number typed as text: `inputmode` brings up the numeric keyboard, and the
 * value stays exactly what was typed, in the reader's own decimal separator,
 * rather than a native `type="number"` that rejects `64,99` in a Spanish
 * locale and spins on a scroll wheel. Tabular figures. Server-safe.
 */
export function NumberInput({
  className,
  inputMode = 'decimal',
  ...props
}: NumberInputProps) {
  return (
    <TextInput
      type="text"
      inputMode={inputMode}
      className={cn('tabular-nums', className)}
      {...props}
    />
  );
}
