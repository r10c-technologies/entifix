import './global.css';
import '../i18n';

import { DocsHead, DocsLayout } from '@entifix/docs-engine/ui';
import type { ReactNode } from 'react';

import { LOCALE } from '../i18n';
import { DARK_PALETTES, site, THEME_IDS } from '../site';
import { Providers } from './providers';

export const metadata = {
  title: { template: '%s · entifix', default: 'entifix' },
};

/** The theme script needs ids only; the captions are the providers'. */
const THEMES = THEME_IDS.map(id => ({ id, label: id }));

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html
      lang={LOCALE}
      data-theme="aurora"
      data-scale="fixed"
      suppressHydrationWarning
    >
      <head>
        <DocsHead
          themes={THEMES}
          defaultTheme="aurora"
          darkPalettes={DARK_PALETTES}
        />
      </head>
      <body>
        <Providers>
          <DocsLayout site={site} title="entifix">
            {children}
          </DocsLayout>
        </Providers>
      </body>
    </html>
  );
}
