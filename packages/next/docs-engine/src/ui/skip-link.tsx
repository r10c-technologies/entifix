'use client';

import { useT } from '@entifix/react-controls';

/**
 * The first stop on every page, as entifix's keyboard walk requires (ADR 0024):
 * it jumps past the sidebar to fumadocs' `main`, `#nd-page`. Hidden until it
 * has focus.
 */
export function SkipLink() {
  const t = useT('controls');
  return (
    <a
      href="#nd-page"
      className="focus:start-2 focus:top-2 focus:bg-fd-background focus:px-3 focus:py-2 focus:text-fd-foreground sr-only focus:not-sr-only focus:fixed focus:z-50 focus:rounded-md"
    >
      {t('docs.skip')}
    </a>
  );
}
