/**
 * The field a confirmed post carries. A form posted without it has not been
 * through the confirmation, so {@link whenConfirmed} does not act on it.
 */
export const CONFIRM_FIELD = '__confirm';

/** The field the interstitial's Cancel posts, to step back without acting. */
export const CANCEL_FIELD = '__cancel';

/**
 * Where a {@link ConfirmAction} stands: showing its trigger, or — after a post
 * that skipped the confirmation — asking.
 */
export interface ConfirmActionState {
  readonly step: 'idle' | 'confirm';
}

export const CONFIRM_ACTION_IDLE: ConfirmActionState = { step: 'idle' };

/**
 * The guard a Server Action behind a `ConfirmAction` runs first
 * ([ADR 0026](../../../../../../docs/adr/0026-actions-hierarchy-overflow-and-destructive-verbs.md)).
 *
 * It acts only on a post that carries {@link CONFIRM_FIELD}, so a form posted
 * straight to the action — a script, a stale page, a first post without
 * JavaScript — is answered with the confirmation step instead. The check lives
 * in the action, not the page, because the action is what a post reaches.
 *
 * ```ts
 * 'use server';
 * export async function cancelOrder(state: ConfirmActionState, form: FormData) {
 *   return whenConfirmed(form, () => orders.cancel(String(form.get('id'))));
 * }
 * ```
 */
export async function whenConfirmed(
  formData: FormData,
  act: () => unknown,
): Promise<ConfirmActionState> {
  if (formData.get(CANCEL_FIELD) !== null) return CONFIRM_ACTION_IDLE;
  if (formData.get(CONFIRM_FIELD) !== '1') return { step: 'confirm' };
  await act();
  return CONFIRM_ACTION_IDLE;
}
