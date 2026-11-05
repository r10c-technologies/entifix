import type { ComponentPropsWithoutRef, ReactNode } from 'react';

import { cn } from '../../utils/cn.js';
import { type Tone, TONE_SURFACE } from '../alert/tone.js';

export type StatusTagTone = Tone | 'neutral';

const TONE_CLASS: Record<StatusTagTone, string> = {
  ...TONE_SURFACE,
  neutral: 'border-border bg-surface text-content-muted',
};

export interface StatusTagProps extends Omit<
  ComponentPropsWithoutRef<'span'>,
  'children'
> {
  tone: StatusTagTone;
  /** The status in words. Required and non-empty: colour is never the only carrier (WCAG 1.4.1). */
  children: string;
  /** A glyph before the words; decorative, so hidden from assistive technology. */
  icon?: ReactNode;
}

/**
 * A record's status as a small tag: a tone and the words for it. The words are
 * mandatory, and an empty string throws rather than rendering a coloured dot
 * that means something only to people who can see the colour. Server-safe.
 */
export function StatusTag({
  tone,
  icon,
  className,
  children,
  ...props
}: StatusTagProps) {
  if (children.trim() === '') {
    throw new Error(
      'StatusTag needs its status in words: colour alone carries nothing for someone who cannot see it.',
    );
  }
  return (
    <span
      data-tone={tone}
      className={cn(
        'inline-flex items-center gap-3xs rounded-full border px-2xs text-step-xs font-medium whitespace-nowrap',
        TONE_CLASS[tone],
        className,
      )}
      {...props}
    >
      {icon !== undefined && <span aria-hidden="true">{icon}</span>}
      {children}
    </span>
  );
}
