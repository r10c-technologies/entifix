'use client';

import type { ComponentPropsWithoutRef } from 'react';

import { useT } from '../../../i18n/index.js';
import { cn } from '../../utils/cn.js';

export type AlertDismissProps = Omit<
  ComponentPropsWithoutRef<'button'>,
  'children' | 'type'
>;

/**
 * The × that dismisses an {@link Alert}, passed as its `action`. A client
 * component of its own so `Alert` stays server-safe: dismissing is the one part
 * of a message that needs a handler. Its name comes from the controls catalog.
 */
export function AlertDismiss({ className, ...props }: AlertDismissProps) {
  const t = useT();
  return (
    <button
      type="button"
      aria-label={t('alert.dismiss')}
      className={cn(
        'flex min-h-(--target-min) min-w-(--target-min) items-center justify-center rounded-md focus-ring hover:bg-surface-elevated/60',
        className,
      )}
      {...props}
    >
      <span aria-hidden="true">×</span>
    </button>
  );
}
