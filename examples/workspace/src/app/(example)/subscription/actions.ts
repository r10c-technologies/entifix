'use server';

import {
  type ConfirmActionState,
  whenConfirmed,
} from '@entifix/next-shell/server';
import { cookies } from 'next/headers';

import { SUBSCRIPTION_COOKIE } from './subscription';

/**
 * Ends the subscription — but only for a post that went through the
 * confirmation. A post that skipped it, with or without JavaScript, is answered
 * with the confirmation step instead.
 */
export async function unsubscribe(
  _state: ConfirmActionState,
  formData: FormData,
): Promise<ConfirmActionState> {
  return whenConfirmed(formData, async () => {
    (await cookies()).set(SUBSCRIPTION_COOKIE, 'ended');
  });
}
