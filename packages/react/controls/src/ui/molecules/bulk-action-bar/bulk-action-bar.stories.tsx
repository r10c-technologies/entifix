import type { Meta, StoryObj } from '@storybook/react-vite';

import { BulkActionBar } from './bulk-action-bar.js';

const RETIRE = {
  key: 'retire',
  binding: 'collection' as const,
  placement: 'context-dependent' as const,
  labelKey: 'entity:product-brand.useCases.retire',
};

const meta: Meta = {
  title: 'Molecules/BulkActionBar',
  component: BulkActionBar,
  tags: ['autodocs'],
  parameters: { layout: 'padded' },
};

export default meta;
type Story = StoryObj;

/** Three rows ticked on a page of a larger result. */
export const Selection: Story = {
  render: () => (
    <BulkActionBar
      count={3}
      matchingTotal={42}
      useCases={[RETIRE]}
      onSelectAllMatching={() => undefined}
      onClear={() => undefined}
      onUseCase={() => undefined}
    />
  ),
};

export const Busy: Story = {
  render: () => (
    <BulkActionBar
      count={3}
      useCases={[RETIRE]}
      busy
      onClear={() => undefined}
      onUseCase={() => undefined}
    />
  ),
};
