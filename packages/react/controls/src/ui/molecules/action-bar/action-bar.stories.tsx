import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, userEvent, within } from 'storybook/test';

import { ActionBar, type ActionBarItem } from './action-bar.js';

const noop = () => undefined;
const item = (
  key: string,
  label: string,
  extra: Partial<ActionBarItem> = {},
): ActionBarItem => ({ key, label, onSelect: noop, ...extra });

const meta: Meta<typeof ActionBar> = {
  title: 'Molecules/ActionBar',
  component: ActionBar,
  tags: ['autodocs'],
  parameters: { layout: 'padded' },
};

export default meta;
type Story = StoryObj<typeof ActionBar>;

/** A record's header: one primary, three secondaries, the rest folded. */
export const FormHeader: Story = {
  args: {
    surface: 'form-header',
    items: [
      item('publish', 'Publish', {
        emphasis: 'primary',
        shortcut: 'Mod+Enter',
      }),
      item('duplicate', 'Duplicate'),
      item('preview', 'Preview'),
      item('export', 'Export'),
      item('history', 'History'),
      item('archive', 'Archive', { destructive: true }),
    ],
  },
  play: async ({ canvasElement }) => {
    const page = within(canvasElement);
    await expect(page.getByRole('button', { name: 'Publish' })).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Más acciones' }),
    ).toBeVisible();
  },
};

/** A record's footer: Save is the primary, Delete sits last after a divider. */
export const FormFooter: Story = {
  args: {
    surface: 'form-footer',
    size: 'md',
    items: [
      item('save', 'Save', { emphasis: 'primary', shortcut: 'Mod+S' }),
      item('clone', 'Duplicate'),
      item('delete', 'Delete', { destructive: true }),
    ],
  },
};

/** A list's toolbar: "New" is a link and the primary. */
export const TableToolbar: Story = {
  args: {
    surface: 'table-toolbar',
    items: [
      {
        key: 'new',
        label: 'New',
        emphasis: 'primary',
        href: '#new',
        intent: { kind: 'new' },
      },
      item('import', 'Import'),
      item('export', 'Export'),
    ],
  },
};

/** A selection's bar, where deleting what was selected is what it is for. */
export const BulkBar: Story = {
  args: {
    surface: 'bulk-bar',
    items: [
      item('delete', 'Delete 3', { emphasis: 'primary', destructive: true }),
      item('tag', 'Tag'),
      item('move', 'Move'),
    ],
  },
};

/** A row: its inline verb, then one menu named for the record. */
export const RowMenu: Story = {
  args: {
    surface: 'row-menu',
    menuLabel: 'Actions for Acme',
    items: [
      item('open-tab', 'Open in tab', { rowInline: true }),
      item('tag', 'Tag'),
      item('archive', 'Archive', { destructive: true }),
    ],
  },
  play: async ({ canvasElement }) => {
    const page = within(canvasElement);
    await userEvent.click(
      page.getByRole('button', { name: 'Actions for Acme' }),
    );
    const body = within(canvasElement.ownerDocument.body);
    await expect(await body.findAllByRole('menuitem')).toHaveLength(2);
    await expect(body.getByRole('separator')).toBeInTheDocument();
    await userEvent.keyboard('{Escape}');
  },
};

/**
 * The same header in a 280px container, inside any viewport: the primary,
 * then one menu holding every secondary. A destructive main function — here
 * the selection's Delete — is never folded.
 */
export const Collapsed: Story = {
  render: () => (
    <div className="flex w-(--container-2xs) flex-col gap-s">
      <ActionBar
        surface="form-header"
        items={[
          item('publish', 'Publish', { emphasis: 'primary' }),
          item('duplicate', 'Duplicate'),
          item('preview', 'Preview'),
        ]}
      />
      <ActionBar
        surface="bulk-bar"
        items={[
          item('delete', 'Delete 3', {
            emphasis: 'primary',
            destructive: true,
          }),
          item('tag', 'Tag'),
          item('move', 'Move'),
        ]}
      />
    </div>
  ),
  play: async ({ canvasElement }) => {
    const page = within(canvasElement);
    await expect(page.getByRole('button', { name: 'Delete 3' })).toBeVisible();
    await expect(
      page.queryByRole('button', { name: 'Duplicate' }),
    ).not.toBeInTheDocument();
    const triggers = page.getAllByRole('button', { name: 'Más acciones' });
    await expect(triggers).toHaveLength(2);
  },
};
