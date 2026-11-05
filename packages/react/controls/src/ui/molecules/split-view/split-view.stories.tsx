import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';

import { SplitView } from './split-view.js';

const ITEMS = [
  ['s-1', 'Order 1041', 'Two items, paid by card, ready to dispatch.'],
  ['s-2', 'Order 1042', 'One item, cash on delivery, awaiting the courier.'],
  ['s-3', 'Order 1043', 'Three items, refunded after a cancellation.'],
].map(([id, head, detail]) => ({
  id: id as string,
  head: <span>{head}</span>,
  detail: <p>{detail}</p>,
  href: `#${id}`,
}));

function Chosen() {
  const [selected, setSelected] = useState<string | undefined>('s-2');
  return (
    <SplitView
      label="Orders"
      items={ITEMS}
      selected={selected}
      onSelect={setSelected}
    />
  );
}

const meta: Meta = {
  title: 'Molecules/SplitView',
  component: SplitView,
  tags: ['autodocs'],
  parameters: { layout: 'padded' },
};

export default meta;
type Story = StoryObj;

export const Default: Story = { render: () => <Chosen /> };
