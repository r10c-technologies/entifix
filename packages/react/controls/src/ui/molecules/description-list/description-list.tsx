import type { ComponentPropsWithoutRef, ReactNode } from 'react';

import { cn } from '../../utils/cn.js';

export interface DescriptionListItem {
  /** A stable key; the term itself when it is unique. */
  readonly key?: string;
  readonly term: ReactNode;
  readonly description: ReactNode;
}

export interface DescriptionListProps extends Omit<
  ComponentPropsWithoutRef<'dl'>,
  'children'
> {
  items: readonly DescriptionListItem[];
}

/**
 * Terms and what they are — a record's facts, a product's specifications —
 * as a real `<dl>`, so each value is announced with the term it belongs to.
 * Two columns where there is room, stacked where there is not. Server-safe.
 */
export function DescriptionList({
  items,
  className,
  ...props
}: DescriptionListProps) {
  return (
    <dl
      className={cn(
        'm-0 sm:grid-cols-[minmax(0,1fr)_minmax(0,2fr)] grid grid-cols-1 gap-x-m gap-y-2xs text-step-sm',
        className,
      )}
      {...props}
    >
      {items.map((item, index) => (
        <div key={item.key ?? index} className="contents">
          <dt className="font-medium text-content-muted">{item.term}</dt>
          <dd className="m-0 text-content">{item.description}</dd>
        </div>
      ))}
    </dl>
  );
}
