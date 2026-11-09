'use client';

import { Button, type ConfirmDialogProps, useT } from '@entifix/react-controls';
import { type ReactNode, useActionState, useId, useRef } from 'react';

import {
  CANCEL_FIELD,
  CONFIRM_ACTION_IDLE,
  CONFIRM_FIELD,
  type ConfirmActionState,
} from './confirm-action-state.js';

/** A Server Action written with `whenConfirmed`, as `useActionState` calls it. */
export type ConfirmActionHandler = (
  state: ConfirmActionState,
  formData: FormData,
) => Promise<ConfirmActionState>;

export interface ConfirmActionProps extends Pick<
  ConfirmDialogProps,
  'title' | 'message' | 'tone' | 'confirmLabel' | 'cancelLabel'
> {
  /** The Server Action, guarded by `whenConfirmed`. */
  action: ConfirmActionHandler;
  /** Posted with both steps as hidden inputs — the record's id, typically. */
  fields?: Readonly<Record<string, string>>;
  /** The trigger's label: the verb, as the page offers it. */
  children: ReactNode;
}

/**
 * A Server Action form that asks before it acts, with or without JavaScript
 * ([ADR 0026](../../../../../../docs/adr/0026-actions-hierarchy-overflow-and-destructive-verbs.md)).
 *
 * - **Without JavaScript** the trigger posts, the action answers with the
 *   confirmation step (`whenConfirmed` sees no confirmation field), and the
 *   page renders an interstitial with the title, the consequence and the verb.
 *   Its button posts again, carrying the field, and only that post acts.
 * - **With JavaScript** the trigger opens a native `<dialog>` with the same
 *   copy, Cancel focused, and its button posts the confirmed form.
 *
 * The copy is `ConfirmDialog`'s text slots, already resolved by the page.
 */
export function ConfirmAction({
  action,
  fields = {},
  title,
  message,
  tone = 'neutral',
  confirmLabel,
  cancelLabel,
  children,
}: ConfirmActionProps) {
  const t = useT();
  const [state, formAction, pending] = useActionState(
    action,
    CONFIRM_ACTION_IDLE,
  );
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const messageId = useId();

  const hidden = Object.entries(fields).map(([name, value]) => (
    <input key={name} type="hidden" name={name} value={value} />
  ));
  const cancelText = cancelLabel ?? t('confirm.cancel');
  const confirmButton = (
    <Button
      type="submit"
      name={CONFIRM_FIELD}
      value="1"
      variant={tone === 'destructive' ? 'destructive' : 'primary'}
      disabled={pending}
      onClick={() => dialog.current?.close()}
    >
      {confirmLabel ?? t('confirm.confirm')}
    </Button>
  );
  const copy = (
    <>
      <h2 id={titleId} className="text-step-1 font-semibold text-content">
        {title}
      </h2>
      <p id={messageId} className="mt-2xs text-step-sm text-content-muted">
        {message}
      </p>
    </>
  );

  if (state.step === 'confirm')
    return (
      <section
        aria-labelledby={titleId}
        data-testid="confirm-action-step"
        className="max-w-md rounded-lg border border-border bg-surface p-s"
      >
        {copy}
        <form action={formAction} className="mt-s flex justify-end gap-xs">
          {hidden}
          <Button
            type="submit"
            name={CANCEL_FIELD}
            value="1"
            variant="ghost"
            disabled={pending}
          >
            {cancelText}
          </Button>
          {confirmButton}
        </form>
      </section>
    );

  return (
    <form
      action={formAction}
      onSubmit={event => {
        const submitter = (event.nativeEvent as SubmitEvent).submitter;
        if (submitter?.getAttribute('name') === CONFIRM_FIELD) return;
        // Asked here, before the post; the action asks again if this is skipped.
        event.preventDefault();
        dialog.current?.showModal();
        dialog.current
          ?.querySelector<HTMLElement>('[data-confirm-cancel]')
          ?.focus();
      }}
    >
      {hidden}
      <Button
        type="submit"
        variant={tone === 'destructive' ? 'destructive' : 'secondary'}
        disabled={pending}
      >
        {children}
      </Button>
      <dialog
        ref={dialog}
        role="alertdialog"
        aria-labelledby={titleId}
        aria-describedby={messageId}
        className="max-w-md m-auto w-full rounded-lg border border-border bg-surface p-s text-content shadow-overlay backdrop:bg-scrim"
      >
        {copy}
        <div className="mt-s flex justify-end gap-xs">
          <Button
            data-confirm-cancel
            type="button"
            variant="ghost"
            onClick={() => dialog.current?.close()}
          >
            {cancelText}
          </Button>
          {confirmButton}
        </div>
      </dialog>
    </form>
  );
}
