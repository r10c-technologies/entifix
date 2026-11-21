import { type ThemeOption, ThemeScript } from '@entifix/react-controls';

import { schemeScript } from './scheme.js';

export interface DocsHeadProps {
  /** The same registry `DocsRoot` is given. */
  readonly themes: readonly ThemeOption[];
  readonly defaultTheme?: string;
  /** The palettes fumadocs should treat as dark. */
  readonly darkPalettes: readonly string[];
  readonly nonce?: string;
}

/**
 * The first paint of an exported page: the stored palette from entifix's
 * `ThemeScript` — an export has no server to read the cookie — and the scheme
 * that palette implies. Render it inside <head>, from a server component.
 */
export function DocsHead({
  themes,
  defaultTheme,
  darkPalettes,
  nonce,
}: DocsHeadProps) {
  return (
    <>
      <ThemeScript
        themes={themes}
        {...(defaultTheme === undefined ? {} : { defaultTheme })}
        {...(nonce === undefined ? {} : { nonce })}
      />
      <script
        nonce={nonce}
        dangerouslySetInnerHTML={{ __html: schemeScript(darkPalettes) }}
      />
    </>
  );
}
