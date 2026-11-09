import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import { ConfirmAction, type ConfirmActionHandler } from './confirm-action.js';
import {
  CANCEL_FIELD,
  CONFIRM_FIELD,
  whenConfirmed,
} from './confirm-action-state.js';

// jsdom has `<dialog>` but not its modal API; open and close are all it needs.
beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function (this: HTMLDialogElement) {
    this.setAttribute('open', '');
  };
  HTMLDialogElement.prototype.close = function (this: HTMLDialogElement) {
    this.removeAttribute('open');
  };
});

const form = (entries: Record<string, string>) => {
  const data = new FormData();
  for (const [name, value] of Object.entries(entries)) data.set(name, value);
  return data;
};

describe('whenConfirmed', () => {
  it('refuses a post that skipped the confirmation, and asks instead', async () => {
    const act = vi.fn();

    await expect(whenConfirmed(form({ id: 'o-1' }), act)).resolves.toEqual({
      step: 'confirm',
    });
    expect(act).not.toHaveBeenCalled();
  });

  it('acts on a confirmed post', async () => {
    const act = vi.fn().mockResolvedValue(undefined);

    await expect(
      whenConfirmed(form({ [CONFIRM_FIELD]: '1' }), act),
    ).resolves.toEqual({ step: 'idle' });
    expect(act).toHaveBeenCalledOnce();
  });

  it('steps back without acting on Cancel', async () => {
    const act = vi.fn();

    await expect(
      whenConfirmed(form({ [CANCEL_FIELD]: '1' }), act),
    ).resolves.toEqual({ step: 'idle' });
    expect(act).not.toHaveBeenCalled();
  });
});

/** An action that records each post and answers as the guard would. */
function recordingAction() {
  const posts: FormData[] = [];
  const action: ConfirmActionHandler = async (_state, data) => {
    posts.push(data);
    return whenConfirmed(data, () => undefined);
  };
  return { posts, action };
}

const renderAction = (action: ConfirmActionHandler, tone?: 'destructive') =>
  render(
    <ConfirmAction
      action={action}
      fields={{ id: 'o-1' }}
      title="¿Cancelar el pedido?"
      message="Se devolverá el pago."
      tone={tone}
      confirmLabel="Cancelar pedido"
      cancelLabel="Conservar"
    >
      Cancelar pedido
    </ConfirmAction>,
  );

describe('ConfirmAction', () => {
  it('opens an alert dialog with the copy, Cancel focused, and posts nothing', async () => {
    const { posts, action } = recordingAction();
    renderAction(action);

    await userEvent.click(
      screen.getByRole('button', { name: 'Cancelar pedido' }),
    );

    const dialog = screen.getByRole('alertdialog', {
      name: '¿Cancelar el pedido?',
    });
    expect(dialog).toHaveAccessibleDescription('Se devolverá el pago.');
    expect(
      within(dialog).getByRole('button', { name: 'Conservar' }),
    ).toHaveFocus();
    expect(posts).toHaveLength(0);

    await userEvent.click(
      within(dialog).getByRole('button', { name: 'Conservar' }),
    );
    expect(dialog).not.toHaveAttribute('open');
    expect(posts).toHaveLength(0);
  });

  it('posts the confirmed form, its fields and the confirmation together', async () => {
    const { posts, action } = recordingAction();
    renderAction(action, 'destructive');

    await userEvent.click(
      screen.getByRole('button', { name: 'Cancelar pedido' }),
    );
    const dialog = screen.getByRole('alertdialog');
    const confirm = within(dialog).getByRole('button', {
      name: 'Cancelar pedido',
    });
    expect(confirm.className).toMatch(/bg-danger/);
    await userEvent.click(confirm);

    await waitFor(() => expect(posts).toHaveLength(1));
    expect(posts[0]?.get('id')).toBe('o-1');
    expect(posts[0]?.get(CONFIRM_FIELD)).toBe('1');
    expect(dialog).not.toHaveAttribute('open');
  });

  it('renders the interstitial when a post reaches the action unconfirmed, and acts only on the second', async () => {
    // What a page without JavaScript sees: the first post skipped the dialog.
    const posts: FormData[] = [];
    let calls = 0;
    const action: ConfirmActionHandler = async (_state, data) => {
      posts.push(data);
      calls += 1;
      return calls === 1 ? { step: 'confirm' } : whenConfirmed(data, () => 0);
    };
    render(
      <ConfirmAction action={action} title="¿Archivar?" message="Se ocultará.">
        Archivar
      </ConfirmAction>,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Archivar' }));
    await userEvent.click(
      within(screen.getByRole('alertdialog')).getByRole('button', {
        name: 'Confirmar',
      }),
    );

    const step = await screen.findByTestId('confirm-action-step');
    expect(
      within(step).getByRole('heading', { name: '¿Archivar?' }),
    ).toBeInTheDocument();
    expect(step).toHaveTextContent('Se ocultará.');

    await userEvent.click(
      within(step).getByRole('button', { name: 'Confirmar' }),
    );
    await waitFor(() => expect(posts).toHaveLength(2));
    expect(posts[1]?.get(CONFIRM_FIELD)).toBe('1');
    await waitFor(() =>
      expect(
        screen.queryByTestId('confirm-action-step'),
      ).not.toBeInTheDocument(),
    );
  });

  it('steps back from the interstitial on Cancel', async () => {
    const posts: FormData[] = [];
    const action: ConfirmActionHandler = async (_state, data) => {
      posts.push(data);
      return posts.length === 1
        ? { step: 'confirm' }
        : whenConfirmed(data, () => 0);
    };
    render(
      <ConfirmAction action={action} title="¿Archivar?" message="Se ocultará.">
        Archivar
      </ConfirmAction>,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Archivar' }));
    await userEvent.click(
      within(screen.getByRole('alertdialog')).getByRole('button', {
        name: 'Confirmar',
      }),
    );
    const step = await screen.findByTestId('confirm-action-step');

    await userEvent.click(
      within(step).getByRole('button', { name: 'Cancelar' }),
    );

    await waitFor(() => expect(posts).toHaveLength(2));
    expect(posts[1]?.get(CANCEL_FIELD)).toBe('1');
    expect(
      await screen.findByRole('button', { name: 'Archivar' }),
    ).toBeInTheDocument();
  });
});
