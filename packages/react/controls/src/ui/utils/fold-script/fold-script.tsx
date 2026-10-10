/** A disclosure to close before paint, and when: while `query` matches. */
export interface Fold {
  /** A media query: `(width >= 64rem)`. */
  readonly query: string;
  /** The `<details>` it closes: every element the selector matches. */
  readonly selector: string;
}

/**
 * Closes disclosures before the page paints, by screen width: an inline
 * script, placed after them in the document, that runs long before React
 * hydrates. The HTML leaves them open, which is what a visitor with no script
 * gets; a `<details>` it closes needs `suppressHydrationWarning`.
 *
 * A media query, not a container query: nothing has been laid out yet, so the
 * window is the one width there is to ask.
 */
export function FoldScript({ folds }: { folds: readonly Fold[] }) {
  // `<` escaped, so no selector can close the script element early.
  const data = JSON.stringify(folds).replaceAll('<', '\\u003c');
  const script = `(function () {
  try {
    var folds = ${data};
    for (var f = 0; f < folds.length; f++) {
      if (!window.matchMedia(folds[f].query).matches) continue;
      var found = document.querySelectorAll(folds[f].selector);
      for (var i = 0; i < found.length; i++) found[i].removeAttribute('open');
    }
  } catch (error) {}
})();`;
  return <script dangerouslySetInnerHTML={{ __html: script }} />;
}
