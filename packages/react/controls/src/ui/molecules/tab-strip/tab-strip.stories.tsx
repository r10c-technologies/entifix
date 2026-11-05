import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { expect, userEvent, within } from 'storybook/test';

import { Tab, TabAddButton, TabPanel, type TabState,TabStrip } from './tab-strip.js';

const meta = {
  title: 'Molecules/TabStrip',
  component: TabStrip,
  tags: ['autodocs'],
  parameters: { layout: 'fullscreen' },
} satisfies Meta<typeof TabStrip>;

export default meta;
type Story = StoryObj<typeof meta>;

const TABS: readonly { id: string; label: string; state?: TabState }[] = [
  { id: 'products', label: 'Products' },
  { id: 'brands', label: 'Brands' },
  { id: 'acme', label: 'Acme #123', state: 'dirty' },
  { id: 'widget', label: 'Widget #7', state: 'saving' },
  { id: 'import', label: 'Import', state: 'error' },
];

function Workspace() {
  const [open, setOpen] = useState(TABS);
  const [active, setActive] = useState('products');
  return (
    <div>
      <TabStrip actions={<TabAddButton />}>
        {open.map(tab => (
          <Tab
            key={tab.id}
            id={`tab-${tab.id}`}
            controls="workspace-panel"
            label={tab.label}
            state={tab.state}
            active={tab.id === active}
            onSelect={() => setActive(tab.id)}
            onClose={() => setOpen(tabs => tabs.filter(t => t.id !== tab.id))}
          />
        ))}
      </TabStrip>
      <TabPanel
        id="workspace-panel"
        labelledBy={`tab-${active}`}
        className="p-m"
      >
        {open.find(tab => tab.id === active)?.label}
      </TabPanel>
    </div>
  );
}

/** Arrow keys move between tabs, Enter shows one, Delete closes it. */
export const Default: Story = {
  render: () => <Workspace />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole('tab', { name: 'Products' }));
    await userEvent.keyboard('{ArrowRight}{Enter}');
    await expect(
      canvas.getByRole('tabpanel', { name: 'Brands' }),
    ).toBeInTheDocument();
    await userEvent.keyboard('{Delete}');
    await expect(
      canvas.queryByRole('tab', { name: 'Brands' }),
    ).not.toBeInTheDocument();
  },
};

/**
 * At 320px the tabs scroll inside their own list and the page does not
 * (WCAG 1.4.10).
 */
export const Narrow: Story = {
  parameters: { gate: { viewport: { width: 320, height: 640 } } },
  render: () => <Workspace />,
  play: async ({ canvasElement }) => {
    const root = canvasElement.ownerDocument.documentElement;
    await expect(root.scrollWidth).toBeLessThanOrEqual(root.clientWidth);
    const strip = within(canvasElement).getByRole('tablist').parentElement!;
    await expect(strip.getBoundingClientRect().width).toBeLessThanOrEqual(
      root.clientWidth,
    );
  },
};
