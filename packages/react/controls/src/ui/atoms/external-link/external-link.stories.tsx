import type { Meta, StoryObj } from '@storybook/react-vite';

import { ExternalLink } from './external-link.js';

const meta: Meta = {
  title: 'Atoms/ExternalLink',
  component: ExternalLink,
  tags: ['autodocs'],
};

export default meta;
type Story = StoryObj;

export const Default: Story = {
  render: () => (
    <ExternalLink
      href="https://example.com/docs"
      className="text-primary underline"
    >
      Read the documentation
    </ExternalLink>
  ),
};
