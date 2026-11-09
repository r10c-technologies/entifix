'use client';

import '../i18n';

import type { Locale } from '@entifix/core';
import {
  ANONYMOUS_WORKSPACE_SCOPE,
  PendingFlowsProvider,
} from '@entifix/next-shell';
import {
  ErrorActionsProvider,
  makeIndexedDbUiPreferencesState,
  type ThemeOption,
  ThemeProvider,
  ToastProvider,
  ToastRegion,
  UiPreferencesProvider,
  useT,
} from '@entifix/react-controls';
import { I18nProvider } from '@entifix/react-controls/i18next';
import {
  EntifixQueryProvider,
  NoopPushChannel,
} from '@entifix/react-integration';
import { type PropsWithChildren, useMemo } from 'react';

import { chooseOrganization } from '../organization';

/** What a failure's code can offer: a refused tenant read, a way to choose. */
const ERROR_ACTIONS = { noActiveOrganization: chooseOrganization };

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
      <ThemeProvider
        themes={themes}
        defaultTheme="aurora"
        defaultDensity="compact"
      >
        <UiPreferencesProvider store={uiPreferences}>
          <ErrorActionsProvider actions={ERROR_ACTIONS}>
            <ToastProvider>
              <PendingFlowsProvider
                scope={ANONYMOUS_WORKSPACE_SCOPE}
                channel={NoopPushChannel}
              >
                {children}
              </PendingFlowsProvider>
              <ToastRegion />
            </ToastProvider>
          </ErrorActionsProvider>
        </UiPreferencesProvider>
      </ThemeProvider>
    </EntifixQueryProvider>
  );
}

/**
 * Everything a screen needs above it, and nothing that talks to a server.
 *
 * No adapters provider — `useExampleAdapters` hands out module-scope contexts —
 * and nothing here writes asynchronously.
 *
 * The toast region and the pending-flow provider are mounted anyway, once,
 * the way a host with a server mounts them: every write here settles, so the
 * push channel is the no-op one and nothing ever waits — but the composition
 * is the one a host copies, and it has to compile inside Next.
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
