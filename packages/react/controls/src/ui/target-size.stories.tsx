import type { Meta, StoryObj } from '@storybook/react-vite';
import type { CSSProperties } from 'react';
import { expect } from 'storybook/test';

import { undersizedTargets } from '../../.storybook/target-size.js';
import { Button } from './atoms/button/button.js';
import { Checkbox } from './atoms/field/checkbox.js';
import { TextInput } from './atoms/field/field.js';
import { Switch } from './atoms/switch/switch.js';
import { Breadcrumbs } from './molecules/breadcrumbs/breadcrumbs.js';
import { Menu } from './molecules/menu/menu.js';
import { PaginationLinks } from './molecules/pagination/pagination-links.js';
import { Tab, TabAddButton, TabStrip } from './molecules/tab-strip/tab-strip.js';

const meta: Meta = {
  title: 'Foundations/TargetSize',
  parameters: { layout: 'padded' },
};

export default meta;
type Story = StoryObj;

/**
 * Every small control, under a host that raises the floor to 44px — the usual
 * choice for a touch-first surface. Overriding the one token is all it takes:
 * each control's hit area reaches it, and the painted sizes stay where they
 * are (ADR 0025).
 */
export const TouchFloor: Story = {
  render: () => (
    <div
      data-testid="touch"
      className="flex flex-col items-start gap-s"
      style={{ '--target-min': '44px' } as CSSProperties}
    >
      <div className="flex items-center gap-s">
        <Button size="sm">Save</Button>
        <Checkbox aria-label="Select row" />
        <Checkbox label="Published" defaultChecked />
        <Switch>Visible</Switch>
        <Menu>
          <Menu.Trigger aria-label="More actions">⋯</Menu.Trigger>
        </Menu>
      </div>
      <TextInput aria-label="Name" defaultValue="Sprocket" />
      <TabStrip actions={<TabAddButton />}>
        <Tab id="tab-a" label="Products" active onClose={() => undefined} />
        <Tab id="tab-b" label="Brands" onClose={() => undefined} />
      </TabStrip>
      <Breadcrumbs
        items={[{ label: 'Home', href: '#' }, { label: 'Catalog', href: '#' }, { label: 'Sprocket' }]}
      />
      <PaginationLinks
        currentPage={2}
        pageSize={10}
        totalItems={50}
        hrefFor={page => `?page=${page}`}
        t={key => key}
      />
    </div>
  ),
  play: async ({ canvasElement }) => {
    const touch = canvasElement.querySelector('[data-testid="touch"]')!;
    await expect(undersizedTargets(touch, 44)).toEqual([]);
    // The floor moved the hit areas, not the paint: the checkbox is hit at
    // 44px and still paints a 1rem square inside it.
    const box = touch.querySelector('input[type="checkbox"]')!;
    await expect(box.getBoundingClientRect().width).toBeCloseTo(44, 0);
    await expect(getComputedStyle(box, '::before').top).toBe('14px');
  },
};
