import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, userEvent, waitFor, within } from 'storybook/test';

import { NavMenu, NavMenuCheck } from './nav-menu.js';

const GLOBE = (
  <svg aria-hidden="true" viewBox="0 0 16 16" width="16" height="16">
    <circle cx="8" cy="8" r="7" fill="none" stroke="currentColor" />
  </svg>
);

function LanguageMenu() {
  return (
    <NavMenu label="Language" icon={GLOBE} summary="ES">
      <a href="#es" aria-current="true" className="flex items-center gap-2xs">
        <NavMenuCheck checked />
        Español
      </a>
      <a href="#en" className="flex items-center gap-2xs">
        <NavMenuCheck checked={false} />
        English
      </a>
    </NavMenu>
  );
}

const meta: Meta = {
  title: 'Molecules/NavMenu',
  component: NavMenu,
  tags: ['autodocs'],
};

export default meta;
type Story = StoryObj;

export const Closed: Story = { render: () => <LanguageMenu /> };

/** A no-JavaScript disclosure, open. */
export const Open: Story = {
  render: () => <LanguageMenu />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByLabelText('Language'));
    // The panel fades in from `opacity: 0`, so visibility settles a frame later.
    await waitFor(() =>
      expect(canvas.getByRole('link', { name: 'English' })).toBeVisible(),
    );
  },
};
