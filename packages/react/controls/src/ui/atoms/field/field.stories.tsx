import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, userEvent, within } from 'storybook/test';

import { Switch } from '../switch/switch.js';
import { Checkbox } from './checkbox.js';
import { Select, TextInput } from './field.js';

const meta: Meta = {
  title: 'Atoms/Field',
  component: TextInput,
  tags: ['autodocs'],
};

export default meta;
type Story = StoryObj;

/** The bare inputs every form control composes, each with its own label. */
export const Inputs: Story = {
  render: () => (
    <div className="flex flex-col gap-s">
      <label className="flex flex-col gap-3xs">
        Name
        <TextInput defaultValue="Sprocket" />
      </label>
      <label className="flex flex-col gap-3xs">
        Status
        <Select defaultValue="active">
          <option value="active">Active</option>
          <option value="retired">Retired</option>
        </Select>
      </label>
      <label className="flex flex-col gap-3xs">
        Disabled
        <TextInput disabled defaultValue="Read only" />
      </label>
    </div>
  ),
};

export const Checkboxes: Story = {
  render: () => (
    <div className="flex flex-col gap-s">
      <Checkbox label="Unchecked" />
      <Checkbox label="Checked" defaultChecked />
      <Checkbox label="Some rows selected" indeterminate />
      <Checkbox label="Disabled" disabled />
    </div>
  ),
};

/** Set by the gate (`test-a11y`) for every cell; absent in `storybook dev`. */
const GATED = import.meta.env['STORYBOOK_A11Y_CELL'] !== undefined;

const borderOf = (element: Element) => {
  const style = getComputedStyle(element);
  return {
    style: style.borderTopStyle,
    width: parseFloat(style.borderTopWidth),
  };
};

/**
 * Under forced colours (Windows High Contrast) the system repaints every
 * colour, and anything drawn only as a background disappears. A control's
 * boundary has to be a real border, and focus a real outline, for either to
 * survive (WCAG 1.4.11, ADR 0025).
 */
export const ForcedColors: Story = {
  parameters: {
    gate: { forcedColors: true },
    // Under forced colours the system, not the palette, chooses every colour,
    // and axe does not model that: it reads the palette's text over the
    // forced Canvas and reports a contrast no user sees. Every other rule
    // still runs, and the palette's own contrast is held in every other story.
    a11y: { config: { rules: [{ id: 'color-contrast', enabled: false }] } },
  },
  render: () => (
    <div className="flex flex-col gap-s">
      <label className="flex flex-col gap-3xs">
        Name
        <TextInput defaultValue="Sprocket" />
      </label>
      <label className="flex flex-col gap-3xs">
        Status
        <Select defaultValue="active">
          <option value="active">Active</option>
        </Select>
      </label>
      <Switch defaultChecked>Published</Switch>
    </div>
  ),
  play: async ({ canvasElement }) => {
    if (GATED) {
      await expect(matchMedia('(forced-colors: active)').matches).toBe(true);
    }
    const canvas = within(canvasElement);
    const boundaries = [
      canvas.getByRole('textbox', { name: 'Name' }),
      canvas.getByRole('combobox', { name: 'Status' }),
      canvasElement.querySelector('[data-slot="switch-track"]'),
    ];
    for (const control of boundaries) {
      await expect(control).not.toBeNull();
      const border = borderOf(control as Element);
      await expect(border.style).toBe('solid');
      await expect(border.width).toBeGreaterThanOrEqual(1);
    }

    await userEvent.tab();
    const input = canvas.getByRole('textbox', { name: 'Name' });
    await expect(input).toHaveFocus();
    const outline = getComputedStyle(input);
    await expect(outline.outlineStyle).toBe('solid');
    await expect(parseFloat(outline.outlineWidth)).toBeGreaterThanOrEqual(2);
  },
};
