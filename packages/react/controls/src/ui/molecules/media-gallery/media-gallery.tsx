import type { ComponentPropsWithoutRef, ReactNode } from 'react';

import {
  MediaImage,
  type MediaImageLoader,
} from '../../atoms/media-image/index.js';
import { cn } from '../../utils/cn.js';

export interface MediaGalleryItem {
  /** Unique within the gallery; the slide's element id is derived from it. */
  readonly id: string;
  readonly src: string;
  /** What the image shows. Empty only for an image that adds nothing to the text beside it. */
  readonly alt: string;
  /** Intrinsic width in pixels, when known. */
  readonly width?: number;
  /** Intrinsic height in pixels, when known. */
  readonly height?: number;
}

/** What the gallery decided for one slide, handed to a host's own renderer. */
export interface MediaGallerySlide {
  /** The slide's position, from 0. */
  readonly index: number;
  /** The first slide is fetched first and at once; every other one lazily. */
  readonly priority: boolean;
  /** The `sizes` the slide is shown at. */
  readonly sizes: string;
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
  /**
   * How wide a slide is shown at, as a `sizes` attribute. Defaults to the full
   * viewport width, which is right only when the gallery is.
   */
  sizes?: string;
  /** Width over height of every slide's box. Defaults to `1`, a square. */
  aspectRatio?: number;
  /** Resizes a slide's image per width, so the browser can fetch a smaller one. */
  loader?: MediaImageLoader;
  /**
   * Renders one image; a {@link MediaImage} when omitted. A host rendering its
   * own sized image receives the gallery's decisions for the slide, and the
   * slide's box stays reserved around whatever it returns.
   */
  renderMedia?: (item: MediaGalleryItem, slide: MediaGallerySlide) => ReactNode;
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
  sizes = '100vw',
  aspectRatio = 1,
  loader,
  renderMedia,
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
        const slide: MediaGallerySlide = {
          index,
          priority: index === 0,
          sizes,
        };
        return (
          <figure
            key={item.id}
            id={slideId(item)}
            className="m-0 flex w-full shrink-0 snap-center flex-col gap-2xs"
          >
            {/* The box is reserved before any image arrives, whoever renders
                it, so a late image shifts nothing below it. */}
            <div
              className="flex w-full items-center justify-center overflow-hidden"
              style={{ aspectRatio }}
            >
              {renderMedia === undefined ? (
                <MediaImage
                  src={item.src}
                  alt={item.alt}
                  width={item.width}
                  height={item.height}
                  aspectRatio={aspectRatio}
                  sizes={sizes}
                  priority={slide.priority}
                  loader={loader}
                />
              ) : (
                renderMedia(item, slide)
              )}
            </div>
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
