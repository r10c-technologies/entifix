import { ThemeSwitcher } from '@entifix/react-controls';
import { DocsLayout as FumadocsLayout } from 'fumadocs-ui/layouts/docs';
import type { ReactNode } from 'react';

import type { DocsSite } from '../site.js';
import { SkipLink } from './skip-link.js';

export interface DocsLayoutProps {
  readonly site: DocsSite;
  /** The site's name in the header. */
  readonly title: ReactNode;
  readonly children: ReactNode;
}

/**
 * fumadocs' docs layout over the site's page tree, with entifix's theme
 * switcher in the sidebar's footer in place of fumadocs' own — which only knows
 * light and dark, and would be a second owner of the palette.
 */
export function DocsLayout({ site, title, children }: DocsLayoutProps) {
  return (
    <>
      <SkipLink />
      <FumadocsLayout
        tree={site.pageTree}
        nav={{ title }}
        themeSwitch={{ enabled: false }}
        sidebar={{ footer: <ThemeSwitcher /> }}
      >
        {children}
      </FumadocsLayout>
    </>
  );
}
