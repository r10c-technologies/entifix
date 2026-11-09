/**
 * The cookie a theme is kept in unless a provider names another; the density
 * is kept beside it, under `${name}-density`. Server-safe, so a layout and the
 * inline script can name it without a client boundary.
 */
export const THEME_COOKIE = 'entifix-theme';

/** The density's cookie, beside the theme's. */
export const densityCookie = (themeCookie: string): string =>
  `${themeCookie}-density`;
