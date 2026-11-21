'use client';

import '../i18n';

import { DocsRoot } from '@entifix/docs-engine/ui';
import { type ThemeOption, useT } from '@entifix/react-controls';
import { I18nProvider } from '@entifix/react-controls/i18next';
import { type PropsWithChildren, useMemo } from 'react';

import { LOCALE } from '../i18n';

/** Below `I18nProvider`, so the theme captions resolve. */
function Root({ children }: PropsWithChildren) {
  const t = useT('controls');
  const themes = useMemo<ThemeOption[]>(
    () => [
      { id: 'aurora', label: t('themes.aurora') },
      { id: 'midnight', label: t('themes.midnight') },
    ],
    [t],
  );
  return (
    <DocsRoot
      locale={LOCALE}
      themes={themes}
      defaultTheme="aurora"
      darkPalettes={['midnight']}
      searchIndexUrl="/entifix/pagefind/"
    >
      {children}
    </DocsRoot>
  );
}

export function Providers({ children }: PropsWithChildren) {
  return (
    <I18nProvider locale={LOCALE}>
      <Root>{children}</Root>
    </I18nProvider>
  );
}
