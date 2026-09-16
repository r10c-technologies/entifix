'use client';

import '../i18n';

import type { Locale } from '@entifix/core';
import {
  makeIndexedDbUiPreferencesState,
  type ThemeOption,
  ThemeProvider,
  UiPreferencesProvider,
  useT,
} from '@entifix/react-controls';
import { I18nProvider } from '@entifix/react-controls/i18next';
import { EntifixQueryProvider } from '@entifix/react-integration';
import { type PropsWithChildren, useMemo } from 'react';

// Module scope: a new store per render would reopen the database each time.
const uiPreferences = makeIndexedDbUiPreferencesState();

/** Below `I18nProvider`, so the theme captions resolve in the active locale. */
function Themed({ children }: PropsWithChildren) {
  const t = useT('controls');
  const themes = useMemo<ThemeOption[]>(
    () => [
      { id: 'aurora', label: t('themes.aurora') },
      { id: 'sunset', label: t('themes.sunset') },
      { id: 'midnight', label: t('themes.midnight') },
    ],
    [t],
  );
  return (
    <EntifixQueryProvider>
      <ThemeProvider themes={themes} defaultTheme="aurora">
        <UiPreferencesProvider store={uiPreferences}>
          {children}
        </UiPreferencesProvider>
      </ThemeProvider>
    </EntifixQueryProvider>
  );
}

/**
 * Everything a screen needs above it, and nothing that talks to a server.
 *
 * No adapters provider — `useExampleAdapters` hands out module-scope contexts —
 * and no `PendingTransactionsProvider`: nothing here writes asynchronously, and
 * the shell falls back to a store that tracks nothing.
 */
export function Providers({
  locale,
  children,
}: PropsWithChildren<{ locale: Locale }>) {
  return (
    <I18nProvider locale={locale}>
      <Themed>{children}</Themed>
    </I18nProvider>
  );
}
