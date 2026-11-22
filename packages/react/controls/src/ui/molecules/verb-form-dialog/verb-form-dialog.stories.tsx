import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { expect, within } from 'storybook/test';

import { Button } from '../../atoms/button/button.js';
import { VerbFormDialog } from './verb-form-dialog.js';

function Demo() {
  const [open, setOpen] = useState(true);
  return (
    <>
      <Button onClick={() => setOpen(true)}>Set the unit</Button>
      <VerbFormDialog
        open={open}
        title="Set the unit"
        onCancel={() => setOpen(false)}
      >
        {formId => (
          <form
            id={formId}
            className="flex flex-col gap-3xs"
            onSubmit={event => {
              event.preventDefault();
              setOpen(false);
            }}
          >
            <label htmlFor={`${formId}-unit`} className="text-step-sm">
              Sold by the
            </label>
            <select
              id={`${formId}-unit`}
              name="unit"
              defaultValue="M"
              className="border-border-strong rounded-md border bg-surface p-2xs text-step-0 text-content"
            >
              <option value="UN">Unit</option>
              <option value="M">Metre</option>
            </select>
          </form>
        )}
      </VerbFormDialog>
    </>
  );
}

const meta: Meta = {
  title: 'Molecules/VerbFormDialog',
  component: VerbFormDialog,
  tags: ['autodocs'],
};

export default meta;
type Story = StoryObj;

/** A verb that needs input asks for it here, titled by the verb. */
export const Open: Story = {
  render: () => <Demo />,
  play: async ({ canvasElement }) => {
    const page = within(canvasElement.ownerDocument.body);
    await expect(
      await page.findByRole('dialog', { name: 'Set the unit' }),
    ).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Set the unit' }),
    ).toBeEnabled();
  },
};
