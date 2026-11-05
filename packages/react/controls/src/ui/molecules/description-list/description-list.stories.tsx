import type { Meta, StoryObj } from '@storybook/react-vite';

import { DescriptionList } from './description-list.js';

const meta: Meta<typeof DescriptionList> = {
  title: 'Molecules/DescriptionList',
  component: DescriptionList,
  tags: ['autodocs'],
  parameters: { layout: 'padded' },
};

export default meta;
type Story = StoryObj<typeof DescriptionList>;

export const Specifications: Story = {
  args: {
    items: [
      { term: 'Weight', description: '1,2 kg' },
      { term: 'Material', description: 'Stainless steel' },
      { term: 'Origin', description: 'Guatemala' },
    ],
  },
};
