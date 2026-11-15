import type { Meta, StoryObj } from '@storybook/react-vite';
import { useEffect, useState } from 'react';
import { expect, userEvent, waitFor, within } from 'storybook/test';

import { MediaGallery } from './media-gallery.js';

/** A flat swatch per slide, so the story needs no network. */
const swatch = (fill: string) =>
  `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="480" height="320"><rect width="480" height="320" fill="${fill}"/></svg>`)}`;

const meta: Meta<typeof MediaGallery> = {
  title: 'Molecules/MediaGallery',
  component: MediaGallery,
  tags: ['autodocs'],
  parameters: { layout: 'padded' },
  args: {
    items: [
      { id: 'front', src: swatch('#3768e6'), alt: 'Sprocket, front' },
      { id: 'side', src: swatch('#11803a'), alt: 'Sprocket, side' },
      { id: 'back', src: swatch('#a75c05'), alt: 'Sprocket, back' },
    ],
    labels: {
      region: 'Sprocket photos',
      previous: 'Previous',
      next: 'Next',
      position: (index, total) => `${index} of ${total}`,
    },
  },
};

export default meta;
type Story = StoryObj<typeof MediaGallery>;

/** The scroller takes focus, and each slide's links reach its neighbours. */
export const Default: Story = {
  render: args => (
    <div className="max-w-(--container-md)">
      <MediaGallery {...args} />
    </div>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.tab();
    await expect(
      canvas.getByRole('region', { name: 'Sprocket photos' }),
    ).toHaveFocus();
    await userEvent.tab();
    const next = canvas.getAllByRole('link', { name: 'Next' })[0]!;
    await expect(next).toHaveFocus();
    await expect(next).toHaveAttribute('href', '#media-side');
  },
};

/**
 * A host that renders its own sized image — the shape a framework's image
 * helper returns — still gets the gallery's eager-or-lazy and `sizes`
 * decisions per slide, and the slide's box stays reserved around it.
 */
export const HostRenderedImage: Story = {
  args: {
    sizes: '(min-width: 48rem) 32rem, 100vw',
    aspectRatio: 3 / 2,
    renderMedia: (item, slide) => (
      <img
        src={item.src}
        alt={item.alt}
        width={480}
        height={320}
        sizes={slide.sizes}
        loading={slide.priority ? 'eager' : 'lazy'}
        data-index={slide.index}
        className="h-full w-full object-cover"
      />
    ),
  },
  render: args => (
    <div className="max-w-(--container-md)">
      <MediaGallery {...args} />
    </div>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const [first, second] = canvas.getAllByRole('img');
    await expect(first).toHaveAttribute('loading', 'eager');
    await expect(second).toHaveAttribute('loading', 'lazy');
    await expect(first).toHaveAttribute(
      'sizes',
      '(min-width: 48rem) 32rem, 100vw',
    );
    const box = first!.parentElement!.getBoundingClientRect();
    await expect(Math.round(box.width / box.height)).toBe(Math.round(3 / 2));
  },
};

/** An image whose source arrives late: an empty box first, the picture after. */
function LateGallery(args: Story['args']) {
  const [src, setSrc] = useState<string | undefined>();
  useEffect(() => {
    const timer = setTimeout(() => setSrc(swatch('#3768e6')), 300);
    return () => clearTimeout(timer);
  }, []);
  return (
    <div className="max-w-(--container-md)">
      <MediaGallery
        {...(args as Parameters<typeof MediaGallery>[0])}
        items={[
          {
            id: 'late',
            // An empty image, until the source arrives.
            src:
              src ??
              'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7',
            alt: 'Sprocket, front',
          },
        ]}
      />
      <p data-testid="below">Below the gallery</p>
    </div>
  );
}

/** Nothing below the gallery moves when a late image loads. */
export const LateImage: Story = {
  args: { aspectRatio: 4 / 3 },
  render: args => <LateGallery {...args} />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const below = canvas.getByTestId('below');
    const before = below.getBoundingClientRect().top;
    const image = canvas.getByRole('img') as HTMLImageElement;
    await waitFor(
      () => {
        if (!image.src.startsWith('data:image/svg') || !image.complete) {
          throw new Error('the late image has not loaded yet');
        }
      },
      { timeout: 3000 },
    );
    await expect(below.getBoundingClientRect().top).toBe(before);
  },
};
