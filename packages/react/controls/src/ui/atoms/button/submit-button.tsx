import type { ComponentPropsWithoutRef, ReactNode } from 'react';

import { cn } from '../../utils/cn.js';
import { button, type ButtonVariantProps } from './button-recipe.js';

export interface SubmitButtonProps
  extends
    Omit<ComponentPropsWithoutRef<'button'>, 'type' | 'onClick'>,
    ButtonVariantProps {
  children: ReactNode;
}

/**
 * A form's submit button wearing {@link Button}'s recipe — and a **server**
 * component, like `ButtonLink`. A server-rendered form posts with scripting
 * off, so its button needs no client code and no handler; it takes none, on
 * purpose, since accepting one would quietly demand a client parent.
 */
export function SubmitButton({
  variant,
  size,
  className,
  children,
  ...props
}: SubmitButtonProps) {
  return (
    <button
      type="submit"
      className={cn(button({ variant, size }), className)}
      {...props}
    >
      {children}
    </button>
  );
}
