'use client';

import '../i18n';

import type { ReferenceLabelRegistration } from '@entifix/business';
import type { Locale } from '@entifix/core';
import { Customer, Invoice } from '@entifix/example-workspace-domain';
import {
  ANONYMOUS_WORKSPACE_SCOPE,
  PendingFlowsProvider,
  ReferenceLabelsHost,
} from '@entifix/next-shell';
import {
  type Density,
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
  type InMemoryPushChannel,
  makeInMemoryPushChannel,
} from '@entifix/react-integration';
import { type PropsWithChildren, useMemo } from 'react';

import { exampleAdapters } from '../adapters';
import { chooseOrganization } from '../organization';

/**
 * The tab's push channel. This example has no server to push from, so it is
 * the in-memory one, connected at once — and reachable from the page as
 * `window.examplePush`, so a reader or a journey can drop the stream and watch
 * the workspace say live updates are paused.
 */
const pushChannel = makeInMemoryPushChannel();
pushChannel.connect();

declare global {
  interface Window {
    examplePush?: InMemoryPushChannel;
  }
}
if (typeof window !== 'undefined') window.examplePush = pushChannel;

/** What a failure's code can offer: a refused tenant read, a way to choose. */
const ERROR_ACTIONS = { noActiveOrganization: chooseOrganization };

// Module scope: a new store per render would reopen the database each time.
const uiPreferences = makeIndexedDbUiPreferencesState();

/**
 * How every entity a reference names is read — once, here, where every
 * target's repository is in reach. A screen that shows a customer id or an
 * invoice id shows its name instead, read in one request per entity.
 */
const REFERENCE_LABELS: ReferenceLabelRegistration[] = [
  [Customer, exampleAdapters.customers],
  [Invoice, exampleAdapters.invoices],
];

/** Below `I18nProvider`, so the theme captions resolve in the active locale. */
/** What the layout rendered the page in, read from the reader's cookies. */
interface Appearance {
  readonly theme: string;
  readonly density: Density | undefined;
}

function Themed({
  appearance,
  children,
}: PropsWithChildren<{ appearance: Appearance }>) {
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
        initialTheme={appearance.theme}
        initialDensity={appearance.density}
      >
        <UiPreferencesProvider store={uiPreferences}>
          <ErrorActionsProvider actions={ERROR_ACTIONS}>
            <ToastProvider>
              <PendingFlowsProvider
                scope={ANONYMOUS_WORKSPACE_SCOPE}
                channel={pushChannel}
              >
                <ReferenceLabelsHost registrations={REFERENCE_LABELS}>
                  {children}
                </ReferenceLabelsHost>
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
  appearance,
  children,
}: PropsWithChildren<{ locale: Locale; appearance: Appearance }>) {
  return (
    <I18nProvider locale={locale}>
      <Themed appearance={appearance}>{children}</Themed>
    </I18nProvider>
  );
}
