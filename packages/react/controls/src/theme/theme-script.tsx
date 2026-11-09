import { THEME_COOKIE } from './theme-cookie.js';
import type { ThemeOption } from './types.js';

export interface ThemeScriptProps {
  /** The same registry `ThemeProvider` is given. */
  themes: readonly ThemeOption[];
  /** Painted when nothing valid is stored; the first theme otherwise. */
  defaultTheme?: string;
  /** The cookie `ThemeProvider` keeps the choice in. */
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
 * For a host with no server to read the theme cookie — a static export. One
 * that has a server renders the attributes from `readThemeCookies` instead,
 * and needs no script at all.
 *
 * The stored choice wins; otherwise `defaultTheme`. A stored density is
 * applied the same way; with none stored the document's own `data-density`
 * stands. Nothing is written: only a choice is ever stored.
 *
 * Render it from a server component; it ships no client code.
 */
export function ThemeScript({
  themes,
  defaultTheme,
  storageKey = THEME_COOKIE,
  nonce,
}: ThemeScriptProps) {
  const ids = themes.map(theme => theme.id);
  const fallback = defaultTheme ?? ids[0] ?? '';
  const script = `(function () {
  try {
    var themes = ${JSON.stringify(ids)};
    var key = ${JSON.stringify(storageKey)};
    var read = function (name) {
      var pairs = document.cookie.split('; ');
      for (var i = 0; i < pairs.length; i++) {
        var at = pairs[i].indexOf('=');
        if (pairs[i].slice(0, at) === name)
          return decodeURIComponent(pairs[i].slice(at + 1));
      }
      return null;
    };
    var theme = read(key);
    if (themes.indexOf(theme) === -1) theme = ${JSON.stringify(fallback)};
    document.documentElement.dataset.theme = theme;
    var density = read(key + '-density');
    if (density === 'comfortable' || density === 'compact') {
      document.documentElement.dataset.density = density;
    }
  } catch (error) {}
})();`;
  return <script nonce={nonce} dangerouslySetInnerHTML={{ __html: script }} />;
}
