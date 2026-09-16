import { getServerT } from '@entifix/next-i18n/server';
import { LocaleLink } from '@entifix/next-shell';

import { Preferences } from '../../preferences';

export default async function HomePage() {
  const t = await getServerT('app');
  return (
    <div className="flex max-w-2xl flex-col gap-m p-m">
      <h1 className="text-step-2 font-semibold">{t('home.title')}</h1>
      <p className="text-content-muted">{t('home.body')}</p>
      <LocaleLink href="/workspace" className="text-primary underline">
        {t('home.openWorkspace')}
      </LocaleLink>
      <Preferences />
    </div>
  );
}
