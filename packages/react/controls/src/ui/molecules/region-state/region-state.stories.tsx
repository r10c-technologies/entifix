import { Forbidden, Unavailable } from '@entifix/core';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, within } from 'storybook/test';

import { ButtonLink } from '../../atoms/button/index.js';
import { SkeletonText } from '../../atoms/skeleton/index.js';
import { RegionState } from './region-state.js';

const meta = {
  title: 'Molecules/RegionState',
  component: RegionState,
  tags: ['autodocs'],
  args: { plural: 'Invoices' },
} satisfies Meta<typeof RegionState>;

export default meta;
type Story = StoryObj<typeof meta>;

/**
 * The first load: the organism's skeleton speaks for the region, so the state
 * adds nothing beside it.
 */
export const Loading: Story = {
  args: { isLoading: true, isEmpty: true },
  render: args => (
    <div className="flex flex-col gap-s">
      <SkeletonText lines={3} />
      <RegionState {...args} />
    </div>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.queryByRole('alert')).toBeNull();
    await expect(canvas.queryByRole('button')).toBeNull();
  },
};

/** A failed load, with Retry, over rows kept from before it. */
export const LoadError: Story = {
  args: {
    error: new Unavailable(),
    onRetry: () => undefined,
    hasStaleData: true,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole('alert')).toBeVisible();
    await expect(canvas.getByRole('button')).toBeVisible();
  },
};

/** A refusal says so in its own words, never as a code. */
export const Forbidden403: Story = {
  args: { error: new Forbidden({}), isEmpty: true },
};

/** A filter emptied the region: one sentence and Clear filters. */
export const NoResults: Story = {
  args: { isEmpty: true, isFiltered: true, onClearFilters: () => undefined },
};

/** Nothing here yet: what will appear, and the first record. */
export const Empty: Story = {
  args: {
    isEmpty: true,
    emptyAction: <ButtonLink href="#new">New invoice</ButtonLink>,
  },
};
