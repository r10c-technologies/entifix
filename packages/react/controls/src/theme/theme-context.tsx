'use client';

import {
  createContext,
  type PropsWithChildren,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';

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
   * localStorage key — namespace it per app so apps don't clobber each other.
   * The density is stored beside it, under `${storageKey}-density`.
   */
  storageKey?: string;
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
function read(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string) {
  try {
    window.localStorage.setItem(key, value);
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
  storageKey = 'entifix-theme',
  palettes,
}: ThemeProviderProps) {
  const initial = defaultTheme ?? themes[0]?.id ?? '';
  const [theme, setThemeState] = useState<string>(initial);
  const densityKey = `${storageKey}-density`;
  // `undefined` until a density is stored, chosen or defaulted: the document's
  // own `data-density` stands until then.
  const [density, setDensityState] = useState<Density | undefined>(
    defaultDensity,
  );

  const isKnown = useCallback(
    (value: unknown): value is string =>
      typeof value === 'string' && themes.some(t => t.id === value),
    [themes],
  );

  // Hydrate from a previously stored preference on mount. This intentionally
  // runs in an effect (not a lazy initializer): localStorage is unavailable
  // during SSR, so the server renders `initial` and the client corrects after
  // mount — reading it in render would cause a hydration mismatch. It only
  // reads, so running twice changes nothing.
  useEffect(() => {
    const stored = read(storageKey);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-shot SSR-safe hydration, see comment above
    if (isKnown(stored)) setThemeState(stored);
    // A stored density wins; otherwise the default, otherwise whatever the
    // document was served with, so the context never reports a density the
    // page is not in.
    const storedDensity = read(densityKey);
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
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);
  useEffect(() => {
    if (density !== undefined)
      document.documentElement.dataset.density = density;
  }, [density]);

  const setTheme = useCallback(
    (next: string) => {
      setThemeState(next);
      write(storageKey, next);
    },
    [storageKey],
  );
  const setDensity = useCallback(
    (next: Density) => {
      setDensityState(next);
      write(densityKey, next);
    },
    [densityKey],
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

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used within a ThemeProvider');
  return ctx;
}
