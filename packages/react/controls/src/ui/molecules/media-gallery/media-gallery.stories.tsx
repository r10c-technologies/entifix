import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, userEvent, within } from 'storybook/test';

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
