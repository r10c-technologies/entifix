'use client';

import { type ThemeOption, ThemeProvider } from '@entifix/react-controls';
import type { DefaultSearchDialogProps } from 'fumadocs-ui/components/dialog/search-default';
import { RootProvider } from 'fumadocs-ui/provider/next';
import {
  type ComponentType,
  lazy,
  type PropsWithChildren,
  useEffect,
} from 'react';

import { SCHEME_ATTRIBUTE, schemeOf } from './scheme.js';
import { useDocsTranslations } from './translations.js';

const PagefindSearchDialog = lazy(() => import('./search-dialog.js'));

export interface DocsRootProps extends PropsWithChildren {
  /** The page's language, as the host's i18n negotiated it. */
  readonly locale: string;
  readonly themes: ThemeOption[];
  readonly defaultTheme?: string;
  /** The palettes fumadocs should treat as dark. */
  readonly darkPalettes: readonly string[];
  /** Where Pagefind's index is served, with the app's `basePath`: `/pagefind/`. */
  readonly searchIndexUrl: string;
}

/**
 * Keeps `data-scheme` in step with the palette on the document. It watches the
 * attribute rather than the theme context: the provider writes `data-theme` in
 * its own effect, which runs after this child's, so the context's value would
 * be one commit ahead of the page — and before the stored choice is read, it
 * would paint the default's scheme over the one the first-paint script set.
 */
function SchemeSync({ darkPalettes }: { darkPalettes: readonly string[] }) {
  useEffect(() => {
    const root = document.documentElement;
    const apply = () => {
      const scheme = schemeOf(root.dataset.theme, darkPalettes);
      if (root.getAttribute(SCHEME_ATTRIBUTE) !== scheme) {
        root.setAttribute(SCHEME_ATTRIBUTE, scheme);
      }
    };
    apply();
    const observer = new MutationObserver(apply);
    observer.observe(root, { attributeFilter: ['data-theme'] });
    return () => observer.disconnect();
  }, [darkPalettes]);
  return null;
}

function Fumadocs({
  locale,
  searchIndexUrl,
  children,
}: PropsWithChildren<{ locale: string; searchIndexUrl: string }>) {
  const translations = useDocsTranslations();
  return (
    <RootProvider
      // One owner of dark mode: entifix's `data-theme`. next-themes would be a
      // second, and it also hides fumadocs' switcher (ADR 0031 §4).
      theme={{ enabled: false }}
      search={{
        SearchDialog:
          PagefindSearchDialog as unknown as ComponentType<DefaultSearchDialogProps>,
        options: {
          indexUrl: searchIndexUrl,
        } as Partial<DefaultSearchDialogProps>,
      }}
      i18n={{ locale, translations }}
    >
      {children}
    </RootProvider>
  );
}

/**
 * Everything a docs page needs above it: entifix's theme provider, which owns
 * `data-theme`, and fumadocs' root under it with its own theming off, its
 * strings from the controls catalog and its search on Pagefind.
 *
 * Mount it inside the host's translator (`I18nProvider` from
 * `@entifix/react-controls/i18next`, or any other), so the strings resolve.
 */
export function DocsRoot({
  locale,
  themes,
  defaultTheme,
  darkPalettes,
  searchIndexUrl,
  children,
}: DocsRootProps) {
  return (
    <ThemeProvider
      themes={themes}
      {...(defaultTheme === undefined ? {} : { defaultTheme })}
    >
      <SchemeSync darkPalettes={darkPalettes} />
      <Fumadocs locale={locale} searchIndexUrl={searchIndexUrl}>
        {children}
      </Fumadocs>
    </ThemeProvider>
  );
}
