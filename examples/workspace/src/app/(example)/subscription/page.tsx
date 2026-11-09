import { getServerT } from '@entifix/next-i18n/server';
import { ConfirmAction } from '@entifix/next-shell';
import { cookies } from 'next/headers';

import { unsubscribe } from './actions';
import { SUBSCRIPTION_COOKIE } from './subscription';

/**
 * A server-rendered page with no client boundary of its own, acting through a
 * Server Action form — the case `ConfirmAction` is for. Ending the
 * subscription asks first, as a dialog with JavaScript and as an interstitial
 * step without it.
 */
export default async function SubscriptionPage() {
  const t = await getServerT('app');
  const ended = (await cookies()).get(SUBSCRIPTION_COOKIE)?.value === 'ended';

  return (
    <section className="flex flex-col items-start gap-s p-s">
      <h1 className="text-step-2 font-semibold">{t('subscription.title')}</h1>
      <p data-testid="subscription-status">
        {ended ? t('subscription.ended') : t('subscription.active')}
      </p>
      {!ended && (
        <ConfirmAction
          action={unsubscribe}
          tone="destructive"
          title={t('subscription.confirmTitle')}
          message={t('subscription.confirmMessage')}
          confirmLabel={t('subscription.end')}
          cancelLabel={t('subscription.keep')}
        >
          {t('subscription.end')}
        </ConfirmAction>
      )}
    </section>
  );
}
