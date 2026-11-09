import { densityCookie, THEME_COOKIE } from '@entifix/react-controls';

/** A request's cookies, as `cookies()` from `next/headers` answers them. */
export interface CookieReader {
  get(name: string): { readonly value: string } | undefined;
}

export interface ThemeCookieOptions {
  /** The theme ids the app registers; an unknown stored one is ignored. */
  readonly themes: readonly string[];
  /** The theme when nothing valid is stored; the first one otherwise. */
  readonly defaultTheme?: string;
  /** The density when nothing valid is stored. */
  readonly defaultDensity?: 'comfortable' | 'compact';
  /** The cookie `ThemeProvider` keeps the choice in. */
  readonly storageKey?: string;
}

/**
 * The theme and density a reader chose, read from the request's cookies, so a
 * root layout renders `data-theme` and `data-density` with the page — no paint
 * in the wrong palette, and nothing that changes after it loads. Hand the same
 * values to `ThemeProvider` as `initialTheme` and `initialDensity`.
 */
export function readThemeCookies(
  cookies: CookieReader,
  {
    themes,
    defaultTheme,
    defaultDensity,
    storageKey = THEME_COOKIE,
  }: ThemeCookieOptions,
): { theme: string; density: 'comfortable' | 'compact' | undefined } {
  const stored = cookies.get(storageKey)?.value;
  const density = cookies.get(densityCookie(storageKey))?.value;
  return {
    theme:
      stored !== undefined && themes.includes(stored)
        ? stored
        : (defaultTheme ?? themes[0] ?? ''),
    density:
      density === 'comfortable' || density === 'compact'
        ? density
        : defaultDensity,
  };
}
