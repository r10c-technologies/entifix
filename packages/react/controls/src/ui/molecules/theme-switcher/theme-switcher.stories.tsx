import type { Meta, StoryObj } from '@storybook/react-vite';

import { ThemeProvider } from '../../../theme/theme-context.js';
import { ThemeSwitcher } from './theme-switcher.js';

const THEMES = [
  { id: 'aurora', label: 'Aurora' },
  { id: 'sunset', label: 'Sunset' },
  { id: 'midnight', label: 'Midnight' },
];

const meta: Meta = {
  title: 'Molecules/ThemeSwitcher',
  component: ThemeSwitcher,
  tags: ['autodocs'],
};

export default meta;
type Story = StoryObj;

/**
 * Starts on whatever palette the toolbar chose, so rendering the story never
 * repaints the page under it, and keeps its preference under a key of its own.
 */
export const Default: Story = {
  render: () => (
    <ThemeProvider
      themes={THEMES}
      defaultTheme={document.documentElement.dataset['theme']}
      storageKey="storybook-theme-switcher"
    >
      <ThemeSwitcher />
    </ThemeProvider>
  ),
};
