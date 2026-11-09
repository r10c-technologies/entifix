import './global.css';
// Installs the catalogs for the server graph; `providers.tsx` does it for the
// client graph. Both are needed — see `../i18n.ts`.
import '../i18n';

import { getRequestLocale, getServerT } from '@entifix/next-i18n/server';
import { readThemeCookies } from '@entifix/next-shell/server';
import { cookies } from 'next/headers';
import type { ReactNode } from 'react';

import { fontVariables } from './fonts';
import { Providers } from './providers';

/** The theme ids `Providers` registers. */
const THEME_IDS = ['aurora', 'sunset', 'midnight'];

export async function generateMetadata() {
  const t = await getServerT('app');
  return { title: t('title'), description: t('description') };
}

export default async function RootLayout({
  children,
}: {
  children: ReactNode;
}) {
  const locale = await getRequestLocale();
  // The reader's theme and density, rendered with the page: nothing repaints
  // once it has loaded.
  const appearance = readThemeCookies(await cookies(), {
    themes: THEME_IDS,
    defaultTheme: 'aurora',
    defaultDensity: 'compact',
  });
  return (
    <html
      lang={locale}
      data-theme={appearance.theme}
      data-scale="fixed"
      data-density={appearance.density}
      className={fontVariables}
      suppressHydrationWarning
    >
      <body>
        <Providers locale={locale} appearance={appearance}>
          {children}
        </Providers>
      </body>
    </html>
  );
}
