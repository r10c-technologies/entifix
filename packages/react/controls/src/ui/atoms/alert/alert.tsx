import type { ComponentPropsWithoutRef, ReactNode } from 'react';

import { cn } from '../../utils/cn.js';
import { type Tone, TONE_SURFACE } from './tone.js';

export type { Tone as AlertTone } from './tone.js';

export interface AlertProps
  extends Omit<ComponentPropsWithoutRef<'div'>, 'title' | 'role'> {
  tone: Tone;
  /** A short heading in bold before the message. */
  title?: ReactNode;
  /** What to do about it: a link, a retry button, an {@link AlertDismiss}. */
  action?: ReactNode;
}

/**
 * An inline message: something went wrong, needs attention, worked, or is
 * worth knowing. It stays until the page changes; nothing dismisses it unless
 * the caller passes an {@link AlertDismiss} as its `action`.
 *
 * `danger` is announced at once (`role="alert"`, assertive); every other tone
 * waits its turn (`role="status"`, polite). Never both, and never neither: an
 * inline message a screen reader is not told about is one only sighted users
 * receive. Server-safe — no hooks, no client boundary.
 */
export function Alert({
  tone,
  title,
  action,
  className,
  children,
  ...props
}: AlertProps) {
  return (
    <div
      role={tone === 'danger' ? 'alert' : 'status'}
      data-tone={tone}
      className={cn(
        'flex items-start gap-s rounded-lg border-l-4 px-s py-xs text-step-sm',
        TONE_SURFACE[tone],
        className,
      )}
      {...props}
    >
      <div className="min-w-0 flex flex-1 flex-col gap-3xs">
        {title !== undefined && <p className="m-0 font-semibold">{title}</p>}
        <div>{children}</div>
      </div>
      {action !== undefined && <div className="shrink-0">{action}</div>}
    </div>
  );
}

/** The same message under the name some hosts look for. */
export const InlineMessage = Alert;
