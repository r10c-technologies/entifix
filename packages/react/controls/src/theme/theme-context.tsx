'use client';

import { Effect } from 'effect';
import {
  createContext,
  type PropsWithChildren,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';

import { useUiPreferencesState } from '../preferences/ui-preferences-context.js';
import { densityCookie, THEME_COOKIE } from './theme-cookie.js';
import type {
  Density,
  ThemeContextValue,
  ThemeOption,
  ThemePalette,
} from './types.js';

const ThemeContext = createContext<ThemeContextValue | null>(null);

export interface ThemeProviderProps extends PropsWithChildren {
  /** The themes this app exposes. First entry is the default unless
   *  `defaultTheme` is given. Drives `data-theme` + the switcher. */
  themes: ThemeOption[];
  /** Theme id used for the first paint / when nothing is stored. */
  defaultTheme?: string;
  /**
   * The density when nothing is stored. Omitted, the provider leaves
   * `data-density` as the document has it until a density is chosen.
   */
  defaultDensity?: Density;
  /**
   * The cookie the theme is kept in — namespace it per app so apps don't
   * clobber each other. The density is kept beside it, under
   * `${storageKey}-density`. A cookie rather than local storage, so a server
   * can read the choice and render `data-theme` and `data-density` with the
   * page: no paint in the wrong palette before a script corrects it.
   */
  storageKey?: string;
  /**
   * The theme and density the server read from those cookies and rendered
   * the page in (`readThemeCookies` in `@entifix/next-shell/server`). Given,
   * the provider starts there and nothing changes after the page loads.
   */
  initialTheme?: string;
  initialDensity?: Density;
  /**
   * Runtime palettes for brands not shipped as CSS presets (multi-tenant /
   * white-label). Keyed by theme id; injected as `[data-theme='id']{…}` vars
   * appended after the app stylesheet, so they override static presets.
   */
  palettes?: Record<string, ThemePalette>;
}

const DENSITIES: readonly Density[] = ['comfortable', 'compact'];

const isDensity = (value: unknown): value is Density =>
  DENSITIES.includes(value as Density);

/** Storage that may be absent or refuse (a private window, blocked site data). */
/** A year: a preference outlives a session. */
const COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

/** A first-party cookie's value, or `null` when it is not set. */
function readCookie(name: string): string | null {
  try {
    for (const pair of document.cookie.split('; ')) {
      const at = pair.indexOf('=');
      if (pair.slice(0, at) === name)
        return decodeURIComponent(pair.slice(at + 1));
    }
  } catch {
    // A sandboxed document refuses cookies; nothing was stored, then.
  }
  return null;
}

function writeCookie(name: string, value: string) {
  try {
    document.cookie = `${name}=${encodeURIComponent(value)}; path=/; max-age=${COOKIE_MAX_AGE}; samesite=lax`;
  } catch {
    // Nothing to remember it in; the choice still applies to this page.
  }
}

/**
 * Applies the active palette and density by writing `data-theme` and
 * `data-density` on <html>, and remembers what the user chooses. Static palette
 * VALUES live in CSS (@entifix/style presets or an app-local themes.css); this
 * flips the selector. Dynamic palettes passed via `palettes` are injected at
 * runtime under the same `data-theme` mechanism.
 *
 * ⚠️ **Only a choice is written to storage, never a default.** The provider
 * used to persist whatever theme it held from an effect, and under StrictMode
 * the effect ran before the stored value had been read back: the default
 * overwrote the stored theme, and a reload in development always came back on
 * the default. Writing in `setTheme` and `setDensity` alone means mounting,
 * however many times, can never lose what was chosen.
 */
export function ThemeProvider({
  children,
  themes,
  defaultTheme,
  defaultDensity,
  storageKey = THEME_COOKIE,
  palettes,
  initialTheme,
  initialDensity,
}: ThemeProviderProps) {
  const initial = initialTheme ?? defaultTheme ?? themes[0]?.id ?? '';
  const [theme, setThemeState] = useState<string>(initial);
  const densityKey = densityCookie(storageKey);
  // `undefined` until a density is stored, chosen or defaulted: the document's
  // own `data-density` stands until then.
  const [density, setDensityState] = useState<Density | undefined>(
    initialDensity ?? defaultDensity,
  );
  const preferences = useUiPreferencesState();

  const isKnown = useCallback(
    (value: unknown): value is string =>
      typeof value === 'string' && themes.some(t => t.id === value),
    [themes],
  );

  // Read the stored choice on mount, for a host that could not: a static
  // export has no server to read the cookie, so it renders `initial` and the
  // client corrects after mount. Reading in render would mismatch hydration.
  // Where the server read it, `initial` already is the stored choice and this
  // changes nothing. It only reads, so running twice changes nothing.
  useEffect(() => {
    const stored = readCookie(storageKey);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-shot SSR-safe hydration, see comment above
    if (isKnown(stored)) setThemeState(stored);
    // A stored density wins; otherwise the default, otherwise whatever the
    // document was served with, so the context never reports a density the
    // page is not in.
    const storedDensity = readCookie(densityKey);
    const served = document.documentElement.dataset.density;
    if (isDensity(storedDensity)) setDensityState(storedDensity);
    else if (defaultDensity === undefined && isDensity(served)) {
      setDensityState(served);
    }
  }, [storageKey, densityKey, isKnown, defaultDensity]);

  // Inject runtime palettes as a single <style> appended to <head>. Being last
  // in the cascade, these win over any static preset defining the same tokens.
  useEffect(() => {
    if (!palettes || Object.keys(palettes).length === 0) return;
    const styleId = `${storageKey}-runtime-palettes`;
    const css = Object.entries(palettes)
      .map(([id, palette]) => {
        const decls = Object.entries(palette)
          .map(([token, value]) => `--color-${token}: ${value};`)
          .join(' ');
        return `[data-theme='${id}'] { ${decls} }`;
      })
      .join('\n');

    let el = document.getElementById(styleId) as HTMLStyleElement | null;
    if (!el) {
      el = document.createElement('style');
      el.id = styleId;
      document.head.appendChild(el);
    }
    el.textContent = css;
  }, [palettes, storageKey]);

  // Reflect the active theme and density onto the document. Storage is not
  // touched here — see the ⚠️ above.
  //
  // Written only when it differs: a page the server rendered in the stored
  // theme is already right, and even a write of the same value is a change
  // something watching the document would see.
  useEffect(() => {
    const root = document.documentElement;
    if (root.dataset.theme !== theme) root.dataset.theme = theme;
  }, [theme]);
  useEffect(() => {
    const root = document.documentElement;
    if (density !== undefined && root.dataset.density !== density)
      root.dataset.density = density;
  }, [density]);

  // The cookie is what the next page is rendered in; the UI-preferences port
  // gets a copy, so a host that keeps preferences server-side has them too.
  const remember = useCallback(
    (cookie: string, key: 'theme' | 'density', value: string) => {
      writeCookie(cookie, value);
      void Effect.runPromise(preferences.write(key, value)).catch(
        () => undefined,
      );
    },
    [preferences],
  );
  const setTheme = useCallback(
    (next: string) => {
      setThemeState(next);
      remember(storageKey, 'theme', next);
    },
    [storageKey, remember],
  );
  const setDensity = useCallback(
    (next: Density) => {
      setDensityState(next);
      remember(densityKey, 'density', next);
    },
    [densityKey, remember],
  );

  const value = useMemo<ThemeContextValue>(
    () => ({
      theme,
      setTheme,
      themes,
      density: density ?? 'comfortable',
      setDensity,
    }),
    [theme, setTheme, themes, density, setDensity],
  );

  return (
    <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
  );
}

/** The theme context, or `null` outside a {@link ThemeProvider}. */
export const useOptionalTheme = (): ThemeContextValue | null =>
  useContext(ThemeContext);

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used within a ThemeProvider');
  return ctx;
}
