import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { VerbFormDialog } from './verb-form-dialog.js';

const fields = (onSubmit: (unit: string) => void) => (formId: string) => (
  <form
    id={formId}
    onSubmit={event => {
      event.preventDefault();
      onSubmit(String(new FormData(event.currentTarget).get('unit') ?? ''));
    }}
  >
    <label>
      Unit
      <input name="unit" defaultValue="M" />
    </label>
  </form>
);

describe('VerbFormDialog', () => {
  it('renders nothing while closed', () => {
    render(
      <VerbFormDialog open={false} title="Set the unit" onCancel={vi.fn()}>
        {fields(vi.fn())}
      </VerbFormDialog>,
    );

    expect(screen.queryByTestId('verb-form-dialog')).not.toBeInTheDocument();
  });

  it('is titled by the verb, and its button submits the host’s form', async () => {
    const onSubmit = vi.fn();
    render(
      <VerbFormDialog open title="Set the unit" onCancel={vi.fn()}>
        {fields(onSubmit)}
      </VerbFormDialog>,
    );

    expect(
      screen.getByRole('dialog', { name: 'Set the unit' }),
    ).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Set the unit' }));

    expect(onSubmit).toHaveBeenCalledWith('M');
  });

  it('submits on Enter in a field, through the same form', async () => {
    const onSubmit = vi.fn();
    render(
      <VerbFormDialog open title="Set the unit" onCancel={vi.fn()}>
        {fields(onSubmit)}
      </VerbFormDialog>,
    );

    await userEvent.type(screen.getByLabelText('Unit'), '2{Enter}');

    expect(onSubmit).toHaveBeenCalledWith('M2');
  });

  it('cancels without submitting', async () => {
    const onSubmit = vi.fn();
    const onCancel = vi.fn();
    render(
      <VerbFormDialog open title="Set the unit" onCancel={onCancel}>
        {fields(onSubmit)}
      </VerbFormDialog>,
    );

    await userEvent.click(screen.getByRole('button', { name: 'Cancelar' }));

    expect(onCancel).toHaveBeenCalled();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('holds both buttons while the verb runs', () => {
    render(
      <VerbFormDialog open busy title="Set the unit" onCancel={vi.fn()}>
        {fields(vi.fn())}
      </VerbFormDialog>,
    );

    expect(screen.getByRole('button', { name: 'Set the unit' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Cancelar' })).toBeDisabled();
  });
});
