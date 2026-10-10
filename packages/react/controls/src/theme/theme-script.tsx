import type { ThemeOption } from './types.js';

export interface ThemeScriptProps {
  /** The same registry `ThemeProvider` is given. */
  themes: readonly ThemeOption[];
  /** Painted when nothing valid is stored; the first theme otherwise. */
  defaultTheme?: string;
  /** The key `ThemeProvider` stores the choice under. */
  storageKey?: string;
  /** For a Content-Security-Policy that allows inline scripts by nonce. */
  nonce?: string;
}

/**
 * Sets `data-theme` on <html> before the first paint, so a server-rendered or
 * statically exported page never flashes the wrong palette. Render it inline
 * in <head>: it runs ahead of any stylesheet applying and long before React
 * hydrates.
 *
 * A stored choice wins; otherwise `defaultTheme`, which is then stored too:
 * `ThemeProvider` persists whatever theme it mounts with, and without a stored
 * value to read it would mount with its own default instead. A page whose
 * storage cannot be read is left unthemed, as it would be without the script.
 *
 * Render it from a server component; it ships no client code.
 */
export function ThemeScript({
  themes,
  defaultTheme,
  storageKey = 'entifix-theme',
  nonce,
}: ThemeScriptProps) {
  const ids = themes.map(theme => theme.id);
  const fallback = defaultTheme ?? ids[0] ?? '';
  const script = `(function () {
  try {
    var themes = ${JSON.stringify(ids)};
    var key = ${JSON.stringify(storageKey)};
    var theme = window.localStorage.getItem(key);
    if (themes.indexOf(theme) === -1) {
      theme = ${JSON.stringify(fallback)};
      window.localStorage.setItem(key, theme);
    }
    document.documentElement.dataset.theme = theme;
  } catch (error) {}
})();`;
  return <script nonce={nonce} dangerouslySetInnerHTML={{ __html: script }} />;
}
