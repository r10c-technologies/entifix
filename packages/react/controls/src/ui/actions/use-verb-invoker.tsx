'use client';

import type { UseCaseDescriptor } from '@entifix/core';
import { type ReactNode, useState } from 'react';

import { useT, useTranslateKey } from '../../i18n/index.js';
import { ConfirmDialog } from '../molecules/confirm-dialog/index.js';
import { useToasts } from '../molecules/toast-region/index.js';

/**
 * A `matching` selection larger than this asks for the count to be typed
 * before a destructive verb runs over it.
 */
export const TYPED_SELECTION_THRESHOLD = 1000;

/** One verb about to run, and what it runs on. */
export interface VerbRequest<TTarget> {
  readonly descriptor: Pick<
    UseCaseDescriptor,
    'key' | 'labelKey' | 'confirm' | 'reversible' | 'inverse'
  >;
  readonly target: TTarget;
  /** What it acts on, as the dialog names it: "Acme", "12 invoices". */
  readonly object: string;
  /** How many records; 1 for a single record. */
  readonly count: number;
  /** A selection of everything a filter matches, rather than ticked rows. */
  readonly matching?: boolean;
}

export interface VerbInvokerOptions<TTarget> {
  /** Runs a verb — the descriptor's own, or its inverse on Undo — by key. */
  readonly run: (key: string, target: TTarget) => void;
  readonly busy?: boolean;
  readonly typedThreshold?: number;
  /**
   * The verbs this caller may run — the served document's `useCases`, which
   * leave out what the caller holds no grant for. Undo is offered only when
   * its `inverse` is one of them. Without it, every verb may run.
   */
  readonly served?: readonly Pick<UseCaseDescriptor, 'key'>[];
}

export interface VerbInvoker<TTarget> {
  readonly invoke: (request: VerbRequest<TTarget>) => void;
  /** The confirmation, while one is open. Render it once, anywhere. */
  readonly dialog: ReactNode;
}

/**
 * Where every surface sends a verb, so none can reach one around its safety
 * ([ADR 0026](../../../../../../docs/adr/0026-actions-hierarchy-overflow-and-destructive-verbs.md)):
 *
 * - no `confirm` — it runs;
 * - `reversible: 'undo'` — it runs, and a toast offers Undo, which runs its
 *   `inverse`. Without a toast region to offer Undo in, or an inverse this
 *   caller may run, it asks instead;
 * - `confirm` — an alert dialog asks a question naming the object and the
 *   count, and the button repeats the verb with the count;
 * - `typed`, or a `matching` selection over {@link TYPED_SELECTION_THRESHOLD}
 *   — the same dialog, and the name or the count has to be typed first.
 */
export function useVerbInvoker<TTarget>({
  run,
  busy = false,
  typedThreshold = TYPED_SELECTION_THRESHOLD,
  served,
}: VerbInvokerOptions<TTarget>): VerbInvoker<TTarget> {
  const t = useT();
  const translateKey = useTranslateKey();
  const toasts = useToasts();
  const [pending, setPending] = useState<VerbRequest<TTarget> | undefined>(
    undefined,
  );

  const invoke = (request: VerbRequest<TTarget>) => {
    const { descriptor, target, object } = request;
    const { confirm, inverse } = descriptor;
    if (confirm === undefined) {
      run(descriptor.key, target);
      return;
    }
    if (
      descriptor.reversible === 'undo' &&
      inverse !== undefined &&
      (served === undefined ||
        served.some(useCase => useCase.key === inverse)) &&
      toasts !== undefined
    ) {
      run(descriptor.key, target);
      const verb = translateKey(descriptor.labelKey);
      toasts.show({
        tone: 'undo',
        message:
          confirm.doneKey === undefined
            ? t('confirm.done', { verb, object })
            : translateKey(confirm.doneKey, { object, count: request.count }),
        action: {
          label: t('confirm.undo'),
          onAction: () => run(inverse, target),
        },
      });
      return;
    }
    setPending(request);
  };

  if (pending === undefined) return { invoke, dialog: undefined };

  const { descriptor, object, count } = pending;
  const confirm = descriptor.confirm as NonNullable<
    UseCaseDescriptor['confirm']
  >;
  const verb = translateKey(confirm.confirmLabelKey ?? descriptor.labelKey);
  const typed =
    descriptor.reversible === 'typed' ||
    (pending.matching === true && count > typedThreshold);

  return {
    invoke,
    dialog: (
      <ConfirmDialog
        open
        tone={confirm.tone}
        title={t('confirm.question', {
          verb: translateKey(descriptor.labelKey),
          object,
        })}
        message={translateKey(confirm.messageKey, { object, count })}
        confirmLabel={t('confirm.verbCount', { verb, count })}
        typed={typed ? (count > 1 ? String(count) : object) : undefined}
        busy={busy}
        onCancel={() => setPending(undefined)}
        onConfirm={() => {
          setPending(undefined);
          run(descriptor.key, pending.target);
        }}
      />
    ),
  };
}
