import './global.css';
// Installs the catalogs for the server graph; `providers.tsx` does it for the
// client graph. Both are needed — see `../i18n.ts`.
import '../i18n';

import { getRequestLocale, getServerT } from '@entifix/next-i18n/server';
import { ThemeScript } from '@entifix/react-controls';
import type { ReactNode } from 'react';

import { fontVariables } from './fonts';
import { Providers } from './providers';

/** The ids `Providers` registers; captions do not matter before paint. */
const THEME_IDS = ['aurora', 'sunset', 'midnight'].map(id => ({
  id,
  label: id,
}));

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
  return (
    <html
      lang={locale}
      data-theme="aurora"
      data-scale="fixed"
      data-density="compact"
      className={fontVariables}
      suppressHydrationWarning
    >
      <head>
        {/* A stored theme and density are painted before React hydrates. */}
        <ThemeScript themes={THEME_IDS} defaultTheme="aurora" />
      </head>
      <body>
        <Providers locale={locale}>{children}</Providers>
      </body>
    </html>
  );
}
