/**
 * fumadocs knows two schemes, light and dark; entifix knows palettes. A palette
 * the host declares dark sets `data-scheme="dark"` on <html>, and every `dark:`
 * utility and the code blocks' dark theme follow that attribute — so the one
 * owner of the palette stays `data-theme`, and fumadocs only reads it
 * (ADR 0031 §4).
 */
export const SCHEME_ATTRIBUTE = 'data-scheme';

export const schemeOf = (
  theme: string | undefined,
  darkPalettes: readonly string[],
): 'dark' | 'light' =>
  theme !== undefined && darkPalettes.includes(theme) ? 'dark' : 'light';

/** The same rule as a script, for the first paint, before React loads. */
export const schemeScript = (darkPalettes: readonly string[]): string =>
  `(function () {
  try {
    var root = document.documentElement;
    var dark = ${JSON.stringify(darkPalettes)};
    root.setAttribute('${SCHEME_ATTRIBUTE}', dark.indexOf(root.dataset.theme) === -1 ? 'light' : 'dark');
  } catch (error) {}
})();`;
