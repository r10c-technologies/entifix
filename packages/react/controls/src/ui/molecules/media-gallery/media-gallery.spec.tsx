import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { MediaGallery } from './media-gallery.js';

const LABELS = {
  region: 'Sprocket photos',
  previous: 'Previous',
  next: 'Next',
  position: (index: number, total: number) => `${index} of ${total}`,
};

const ITEMS = [
  { id: 'a', src: '/a.jpg', alt: 'Front' },
  { id: 'b', src: '/b.jpg', alt: 'Side' },
  { id: 'c', src: '/c.jpg', alt: 'Back' },
];

describe('MediaGallery', () => {
  it('is a named, focusable region', () => {
    render(<MediaGallery items={ITEMS} labels={LABELS} />);
    const region = screen.getByRole('region', { name: 'Sprocket photos' });
    expect(region).toHaveAttribute('tabindex', '0');
  });

  it('links each slide to its neighbours by id, with its position', () => {
    const { container } = render(
      <MediaGallery items={ITEMS} labels={LABELS} />,
    );
    const slides = [...container.querySelectorAll('figure')];
    expect(slides.map(slide => slide.id)).toEqual([
      'media-a',
      'media-b',
      'media-c',
    ]);

    const first = within(slides[0]!);
    expect(
      first.queryByRole('link', { name: 'Previous' }),
    ).not.toBeInTheDocument();
    expect(first.getByRole('link', { name: 'Next' })).toHaveAttribute(
      'href',
      '#media-b',
    );
    expect(first.getByText('1 of 3')).toBeInTheDocument();

    const middle = within(slides[1]!);
    expect(middle.getByRole('link', { name: 'Previous' })).toHaveAttribute(
      'href',
      '#media-a',
    );
    expect(middle.getByRole('link', { name: 'Next' })).toHaveAttribute(
      'href',
      '#media-c',
    );

    const last = within(slides[2]!);
    expect(last.queryByRole('link', { name: 'Next' })).not.toBeInTheDocument();
  });

  it('fetches the first slide at once and every later one lazily', () => {
    render(<MediaGallery items={ITEMS} labels={LABELS} />);

    expect(screen.getByRole('img', { name: 'Front' })).toHaveAttribute(
      'fetchpriority',
      'high',
    );
    for (const name of ['Side', 'Back']) {
      const image = screen.getByRole('img', { name });
      expect(image).toHaveAttribute('loading', 'lazy');
      expect(image).not.toHaveAttribute('fetchpriority');
    }
  });

  it('passes its sizes, ratio, loader and known dimensions to each image', () => {
    render(
      <MediaGallery
        items={[{ ...ITEMS[0]!, width: 800, height: 600 }]}
        labels={LABELS}
        sizes="50vw"
        aspectRatio={4 / 3}
        loader={(src, width) => `${src}?w=${width}`}
      />,
    );
    const image = screen.getByRole('img', { name: 'Front' });

    expect(image).toHaveAttribute('sizes', '50vw');
    expect(image).toHaveAttribute('width', '800');
    expect(image.getAttribute('srcset')).toContain('/a.jpg?w=320 320w');
    expect(image.parentElement?.style.aspectRatio).toBe('1.33333 / 1');
  });

  it("hands a host's renderer the slide's decisions, inside the reserved box", () => {
    const seen: unknown[] = [];
    render(
      <MediaGallery
        items={ITEMS}
        labels={LABELS}
        sizes="33vw"
        renderMedia={(item, slide) => {
          seen.push(slide);
          return <span data-testid={`media-${item.id}`} />;
        }}
      />,
    );

    expect(seen).toEqual([
      { index: 0, priority: true, sizes: '33vw' },
      { index: 1, priority: false, sizes: '33vw' },
      { index: 2, priority: false, sizes: '33vw' },
    ]);
    expect(screen.getByTestId('media-c').parentElement?.style.aspectRatio).toBe(
      '1 / 1',
    );
  });
});
