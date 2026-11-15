import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { MEDIA_IMAGE_WIDTHS, MediaImage } from './media-image.js';

describe('MediaImage', () => {
  it('writes no srcset without a loader, since there is nothing to choose between', () => {
    render(<MediaImage src="/a.jpg" alt="Front" sizes="100vw" />);
    const image = screen.getByRole('img', { name: 'Front' });

    expect(image).not.toHaveAttribute('srcset');
    expect(image).toHaveAttribute('src', '/a.jpg');
    expect(image).toHaveAttribute('sizes', '100vw');
  });

  it('offers one candidate per ladder width with a loader', () => {
    render(
      <MediaImage
        src="/a.jpg"
        alt="Front"
        sizes="50vw"
        loader={(src, width) => `${src}?w=${width}`}
      />,
    );
    const srcset = screen.getByRole('img').getAttribute('srcset') ?? '';

    expect(srcset.split(', ')).toEqual(
      MEDIA_IMAGE_WIDTHS.map(width => `/a.jpg?w=${width} ${width}w`),
    );
  });

  it('is lazy and decoded off the main thread unless it is the priority image', () => {
    const { rerender } = render(
      <MediaImage src="/a.jpg" alt="Front" sizes="100vw" />,
    );
    const image = screen.getByRole('img');
    expect(image).toHaveAttribute('loading', 'lazy');
    expect(image).toHaveAttribute('decoding', 'async');
    expect(image).not.toHaveAttribute('fetchpriority');

    rerender(<MediaImage src="/a.jpg" alt="Front" sizes="100vw" priority />);
    expect(image).toHaveAttribute('fetchpriority', 'high');
    expect(image).not.toHaveAttribute('loading');
  });

  it('reserves its box by aspect ratio, square by default, and keeps known dimensions', () => {
    const { rerender } = render(
      <MediaImage src="/a.jpg" alt="Front" sizes="100vw" />,
    );
    const image = screen.getByRole('img');
    expect(image.style.aspectRatio).toBe('1 / 1');
    expect(image).not.toHaveAttribute('width');

    rerender(
      <MediaImage
        src="/a.jpg"
        alt="Front"
        sizes="100vw"
        aspectRatio={4 / 3}
        width={800}
        height={600}
      />,
    );
    expect(image.style.aspectRatio).toBe('1.33333 / 1');
    expect(image).toHaveAttribute('width', '800');
    expect(image).toHaveAttribute('height', '600');
  });
});
