import type { ComponentPropsWithoutRef, ReactNode } from 'react';

import { cn } from '../../utils/cn.js';

export interface EmptyStateProps
  extends Omit<ComponentPropsWithoutRef<'div'>, 'children'> {
  /** One sentence: what is not here, and why when it is not obvious. */
  children: ReactNode;
  /** The one thing to do about it — create the first record, clear a filter. */
  action?: ReactNode;
}

/**
 * What a region shows when it holds nothing: one sentence, and at most one way
 * forward. Not a failure — a region that could not load says so with an
 * `Alert` instead, because an empty result and a dead backend must never look
 * alike. Server-safe.
 */
export function EmptyState({
  action,
  className,
  children,
  ...props
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        'flex flex-col items-center gap-s rounded-lg border border-dashed border-border px-m py-l text-center',
        className,
      )}
      {...props}
    >
      <p className="m-0 max-w-(--measure) text-step-sm text-content-muted">
        {children}
      </p>
      {action}
    </div>
  );
}
