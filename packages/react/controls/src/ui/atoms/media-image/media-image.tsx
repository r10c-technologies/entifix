import type { ComponentPropsWithoutRef } from 'react';

import { cn } from '../../utils/cn.js';

/**
 * The widths a {@link MediaImageLoader} is asked for, narrow to wide. A fixed
 * ladder rather than one per caller: every image on a host is cut at the same
 * few sizes, which is what lets a resizing service cache them.
 */
export const MEDIA_IMAGE_WIDTHS = [320, 480, 640, 960, 1280, 1920] as const;

/**
 * The URL of `src` resized to `width` pixels wide. Supplied by the host, which
 * knows which service, if any, can resize its images; without one, an image
 * is served as it is.
 */
export type MediaImageLoader = (src: string, width: number) => string;

export interface MediaImageProps extends Omit<
  ComponentPropsWithoutRef<'img'>,
  | 'src'
  | 'alt'
  | 'width'
  | 'height'
  | 'sizes'
  | 'srcSet'
  | 'loading'
  | 'decoding'
  | 'fetchPriority'
> {
  src: string;
  /** What the image shows. Empty only for an image that adds nothing to the text beside it. */
  alt: string;
  /** Intrinsic width in pixels, when known. */
  width?: number;
  /** Intrinsic height in pixels, when known. */
  height?: number;
  /**
   * Width over height of the box the image is shown in. The box is reserved
   * before the image arrives, so nothing below it moves when it does.
   * Defaults to `1`, a square.
   */
  aspectRatio?: number;
  /** How wide the image is shown at, as a `sizes` attribute (`(min-width: 48rem) 50vw, 100vw`). */
  sizes: string;
  /**
   * The image is the first thing a reader sees: fetched first and at once,
   * never lazily. One per page at most.
   */
  priority?: boolean;
  /** Resizes `src` per width; given, the image offers one candidate per {@link MEDIA_IMAGE_WIDTHS}. */
  loader?: MediaImageLoader;
}

/**
 * One image, sized for where it is shown. Its box is reserved by aspect
 * ratio, so a late image shifts nothing; it is fetched lazily unless it is the
 * `priority` one; and with a host `loader` it offers a `srcset` the browser
 * picks the smallest fitting candidate from. Without a loader there is nothing
 * to choose between, and no `srcset` is written. Server-safe.
 */
export function MediaImage({
  src,
  alt,
  width,
  height,
  aspectRatio = 1,
  sizes,
  priority = false,
  loader,
  className,
  style,
  ...props
}: MediaImageProps) {
  const srcSet =
    loader === undefined
      ? undefined
      : MEDIA_IMAGE_WIDTHS.map(w => `${loader(src, w)} ${w}w`).join(', ');
  return (
    <img
      src={src}
      alt={alt}
      width={width}
      height={height}
      sizes={sizes}
      srcSet={srcSet}
      {...(priority
        ? { fetchPriority: 'high' as const }
        : { loading: 'lazy' as const, decoding: 'async' as const })}
      className={cn('block h-auto w-full object-contain', className)}
      style={{ aspectRatio, ...style }}
      {...props}
    />
  );
}
