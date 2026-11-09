'use client';

import {
  Dialog,
  DialogDescription,
  DialogPanel,
  DialogTitle,
} from '@headlessui/react';
import { useId, useState } from 'react';

import { useT } from '../../../i18n/index.js';
import { Button } from '../../atoms/button/index.js';
import { TextInput } from '../../atoms/field/index.js';

export type ConfirmTone = 'destructive' | 'neutral';

export interface ConfirmDialogProps {
  open: boolean;
  /**
   * Already-resolved copy — this control renders text, it does not translate.
   * A question naming what is affected and how many: "Delete Acme?",
   * "Archive 12 invoices?".
   */
  title: string;
  /** The consequence, in one or two sentences. */
  message: string;
  /** `destructive` paints the confirm button in the danger tokens. */
  tone?: ConfirmTone;
  /**
   * The confirming button. Repeat the verb, with the count when there is more
   * than one — "Delete 12" — so the reader does not go back to the title to
   * learn what they are agreeing to. Defaults to "Confirm".
   */
  confirmLabel?: string;
  cancelLabel?: string;
  /**
   * Asks the reader to type this — the record's name, or the count — before
   * the confirming button enables: for a destruction too large to be one
   * misplaced click.
   */
  typed?: string;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * Asks before an irreversible act
 * ([ADR 0026](../../../../../../../docs/adr/0026-actions-hierarchy-overflow-and-destructive-verbs.md)).
 *
 * An `alertdialog`, not a `dialog`: it interrupts to ask a question that must
 * be answered. Its message is wired as the dialog's description, so it is read
 * with the title on opening, and **Cancel takes the initial focus** — Enter on
 * a dialog that opened under the reader's hand keeps what they have.
 *
 * The dialog element fills the viewport rather than wrapping a `fixed` child in
 * a `relative` box, for the reason `EntityLinkPicker` records: a zero-sized
 * dialog is invisible to anything that measures it — assistive tech and
 * Playwright alike — even with a painted panel inside.
 */
export function ConfirmDialog({
  open,
  title,
  message,
  tone = 'neutral',
  confirmLabel,
  cancelLabel,
  typed,
  busy = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const t = useT();
  const inputId = useId();
  const [entered, setEntered] = useState('');
  const matches = typed === undefined || entered.trim() === typed;

  return (
    <Dialog
      open={open}
      role="alertdialog"
      onClose={onCancel}
      className="inset-0 fixed z-(--z-overlay) flex items-center justify-center overflow-y-auto p-s"
    >
      <div aria-hidden className="inset-0 fixed bg-scrim" />
      <DialogPanel
        data-testid="confirm-dialog"
        className="max-w-md relative w-full rounded-lg border border-border bg-surface p-s shadow-overlay"
      >
        <DialogTitle className="text-step-1 font-semibold text-content">
          {title}
        </DialogTitle>
        <DialogDescription className="mt-2xs text-step-sm text-content-muted">
          {message}
        </DialogDescription>
        {typed !== undefined && (
          <div className="mt-s flex flex-col gap-3xs">
            <label htmlFor={inputId} className="text-step-sm text-content">
              {t('confirm.typeToConfirm', { expected: typed })}
            </label>
            <TextInput
              id={inputId}
              autoComplete="off"
              spellCheck={false}
              value={entered}
              onChange={event => setEntered(event.currentTarget.value)}
            />
          </div>
        )}
        <div className="mt-s flex justify-end gap-xs">
          <Button
            type="button"
            variant="ghost"
            data-autofocus
            onClick={onCancel}
            disabled={busy}
          >
            {cancelLabel ?? t('confirm.cancel')}
          </Button>
          <Button
            type="button"
            variant={tone === 'destructive' ? 'destructive' : 'primary'}
            onClick={onConfirm}
            disabled={busy || !matches}
          >
            {confirmLabel ?? t('confirm.confirm')}
          </Button>
        </div>
      </DialogPanel>
    </Dialog>
  );
}
