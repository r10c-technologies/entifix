import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, within } from 'storybook/test';

import { MediaImage } from './media-image.js';

/** A flat swatch, so the story needs no network. */
const swatch = (fill: string) =>
  `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="480" height="320"><rect width="480" height="320" fill="${fill}"/></svg>`)}`;

const meta: Meta<typeof MediaImage> = {
  title: 'Atoms/MediaImage',
  component: MediaImage,
  tags: ['autodocs'],
  parameters: { layout: 'padded' },
  args: {
    src: swatch('#3768e6'),
    alt: 'Sprocket, front',
    sizes: '(min-width: 48rem) 24rem, 100vw',
    aspectRatio: 3 / 2,
  },
};

export default meta;
type Story = StoryObj<typeof MediaImage>;

/** Lazy, in a box reserved by its ratio. */
export const Default: Story = {
  render: args => (
    <div className="max-w-(--container-xs)">
      <MediaImage {...args} />
    </div>
  ),
  play: async ({ canvasElement }) => {
    const image = within(canvasElement).getByRole('img', {
      name: 'Sprocket, front',
    });
    await expect(image).toHaveAttribute('loading', 'lazy');
    await expect(image).not.toHaveAttribute('srcset');
  },
};

/** The first thing a reader sees: fetched at once, with a host's resized candidates. */
export const PriorityWithLoader: Story = {
  args: {
    priority: true,
    loader: (src, width) => `${src}#w=${width}`,
  },
  render: args => (
    <div className="max-w-(--container-xs)">
      <MediaImage {...args} />
    </div>
  ),
  play: async ({ canvasElement }) => {
    const image = within(canvasElement).getByRole('img');
    await expect(image).toHaveAttribute('fetchpriority', 'high');
    await expect(image.getAttribute('srcset')).toContain('320w');
  },
};
