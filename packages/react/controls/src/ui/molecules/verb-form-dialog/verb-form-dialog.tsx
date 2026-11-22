'use client';

import { Dialog, DialogPanel, DialogTitle } from '@headlessui/react';
import { type ReactNode, useId } from 'react';

import { useT } from '../../../i18n/index.js';
import { Button } from '../../atoms/button/index.js';

export interface VerbFormDialogProps {
  open: boolean;
  /** The verb's own words: its label is the question and the submit button. */
  title: string;
  /**
   * The host's fields, rendered inside a `<form>` with the given `formId`. The
   * form's submit event is the host's to read; the dialog only owns the
   * frame, Cancel and the submit button that targets the form by id.
   */
  children: (formId: string) => ReactNode;
  busy?: boolean;
  onCancel: () => void;
}

/**
 * The frame a verb's form opens in: a dialog titled with the verb, the host's
 * fields, Cancel, and a submit button carrying the verb's name. A verb that
 * needs input — the unit an offering is sold in, the reference of a payment —
 * is asked for here rather than posted from a button with nothing in it.
 *
 * The fields are the host's because only the host knows what the verb needs;
 * the button is outside the host's `<form>` and names it by `form`, so Enter in
 * a field and a click both submit through the host's own handler.
 */
export function VerbFormDialog({
  open,
  title,
  children,
  busy = false,
  onCancel,
}: VerbFormDialogProps) {
  const t = useT();
  const formId = useId();

  return (
    <Dialog
      open={open}
      onClose={onCancel}
      className="inset-0 fixed z-(--z-overlay) flex items-center justify-center overflow-y-auto p-s"
    >
      <div aria-hidden className="inset-0 fixed bg-scrim" />
      <DialogPanel
        data-testid="verb-form-dialog"
        className="max-w-md relative w-full rounded-lg border border-border bg-surface p-s shadow-overlay"
      >
        <DialogTitle className="text-step-1 font-semibold text-content">
          {title}
        </DialogTitle>
        <div className="mt-s flex flex-col gap-xs">{children(formId)}</div>
        <div className="mt-s flex justify-end gap-xs">
          <Button
            type="button"
            variant="ghost"
            onClick={onCancel}
            disabled={busy}
          >
            {t('confirm.cancel')}
          </Button>
          <Button type="submit" form={formId} disabled={busy}>
            {title}
          </Button>
        </div>
      </DialogPanel>
    </Dialog>
  );
}
