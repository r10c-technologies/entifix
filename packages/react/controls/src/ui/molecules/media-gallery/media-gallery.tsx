import type { ComponentPropsWithoutRef, ReactNode } from 'react';

import { cn } from '../../utils/cn.js';

export interface MediaGalleryItem {
  /** Unique within the gallery; the slide's element id is derived from it. */
  readonly id: string;
  readonly src: string;
  /** What the image shows. Empty only for an image that adds nothing to the text beside it. */
  readonly alt: string;
}

export interface MediaGalleryLabels {
  /** The gallery's name — usually the product's. */
  readonly region: string;
  readonly previous: string;
  readonly next: string;
  /** A slide's position, e.g. `2 of 5`. */
  readonly position: (index: number, total: number) => string;
}

export interface MediaGalleryProps extends Omit<
  ComponentPropsWithoutRef<'div'>,
  'children'
> {
  items: readonly MediaGalleryItem[];
  labels: MediaGalleryLabels;
  /** Renders one image; a plain `<img>` when omitted (a Next host passes `next/image`). */
  renderMedia?: (item: MediaGalleryItem) => ReactNode;
}

const slideId = (item: MediaGalleryItem) => `media-${item.id}`;

const STEP =
  'flex min-h-(--target-min) items-center rounded-md px-2xs text-step-sm text-content focus-ring hover:underline';

/**
 * Product media as a horizontal scroller that works with scripting off and
 * with a keyboard. The scroller is a named region and a Tab stop, so arrow
 * keys scroll it (WCAG 2.1.1, axe `scrollable-region-focusable`); each slide is
 * a figure with its position, and its previous and next links jump to the
 * neighbouring slide's id, which the browser scrolls into view. Server-safe.
 */
export function MediaGallery({
  items,
  labels,
  renderMedia = item => (
    <img
      src={item.src}
      alt={item.alt}
      className="h-auto w-full object-contain"
    />
  ),
  className,
  ...props
}: MediaGalleryProps) {
  return (
    <div
      role="region"
      aria-label={labels.region}
      // A scroller must take focus to be scrolled from the keyboard.
      // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex
      tabIndex={0}
      className={cn(
        'flex snap-x snap-mandatory gap-s overflow-x-auto scroll-smooth rounded-lg focus-ring motion-reduce:scroll-auto',
        className,
      )}
      {...props}
    >
      {items.map((item, index) => {
        const previous = items[index - 1];
        const next = items[index + 1];
        return (
          <figure
            key={item.id}
            id={slideId(item)}
            className="m-0 flex w-full shrink-0 snap-center flex-col gap-2xs"
          >
            {renderMedia(item)}
            <figcaption className="flex items-center justify-between gap-s text-step-xs text-content-muted">
              {previous ? (
                <a href={`#${slideId(previous)}`} className={STEP}>
                  {labels.previous}
                </a>
              ) : (
                <span />
              )}
              <span>{labels.position(index + 1, items.length)}</span>
              {next ? (
                <a href={`#${slideId(next)}`} className={STEP}>
                  {labels.next}
                </a>
              ) : (
                <span />
              )}
            </figcaption>
          </figure>
        );
      })}
    </div>
  );
}
