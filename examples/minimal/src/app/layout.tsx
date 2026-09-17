import './global.css';
// Installs the catalogs for the server graph; `providers.tsx` does it for the
// client graph. Both are needed — see `../i18n.ts`.
import '../i18n';

import { getRequestLocale, getServerT } from '@entifix/next-i18n/server';
import type { ReactNode } from 'react';

import { fontVariables } from './fonts';
import { Providers } from './providers';

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
      <body>
        <Providers locale={locale}>{children}</Providers>
      </body>
    </html>
  );
}
