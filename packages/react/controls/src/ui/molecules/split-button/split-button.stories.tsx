import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, userEvent, waitFor, within } from 'storybook/test';

import { button } from '../../atoms/button/button-recipe.js';
import { SplitButton } from './split-button.js';

function Export() {
  return (
    <SplitButton
      primary={
        <a href="#csv" className={button({ variant: 'primary', size: 'sm' })}>
          Export CSV
        </a>
      }
      menuLabel="More formats"
    >
      <a href="#xlsx">Excel workbook</a>
      <a href="#pdf">PDF</a>
    </SplitButton>
  );
}

const meta: Meta = {
  title: 'Molecules/SplitButton',
  component: SplitButton,
  tags: ['autodocs'],
};

export default meta;
type Story = StoryObj;

export const Closed: Story = { render: () => <Export /> };

export const Open: Story = {
  render: () => <Export />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByTitle('More formats'));
    // The panel fades in from `opacity: 0`, so visibility settles a frame later.
    await waitFor(() =>
      expect(canvas.getByRole('link', { name: 'PDF' })).toBeVisible(),
    );
  },
};
