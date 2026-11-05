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

  it('renders plain images, or what the host renders', () => {
    const { rerender } = render(<MediaGallery items={ITEMS} labels={LABELS} />);
    expect(screen.getByRole('img', { name: 'Side' })).toHaveAttribute(
      'src',
      '/b.jpg',
    );
    rerender(
      <MediaGallery
        items={ITEMS}
        labels={LABELS}
        renderMedia={item => <span data-testid={`media-${item.id}`} />}
      />,
    );
    expect(screen.getByTestId('media-c')).toBeInTheDocument();
  });
});
