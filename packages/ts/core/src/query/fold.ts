/**
 * What `like` compares: text with its accents and its case taken off.
 *
 * One rule, stated once, because three engines answer `like` and each needs it
 * in a different form — the in-memory matcher folds both sides, the Mongo
 * adapter cannot fold a stored value and so widens the query instead, and the
 * SQL adapter folds the column with `translate`. Every form is derived from
 * {@link foldText} here, so none of them can drift into a different rule.
 *
 * The rule is Unicode's: decompose (NFD), drop the combining marks, lowercase.
 * `é` is `e`, `ü` is `u`, and `ñ` is `n` — a buyer on a keyboard without the
 * letter types `nino` for `niño`, and finding nothing is the worse answer. A
 * letter that does not decompose (`ß`, `ø`, `æ`, `ł`) is left as it is, by
 * every engine alike.
 */

/** `value` with its accents and case removed. */
export const foldText = (value: string): string =>
  value.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

/**
 * The precomposed letters each base letter stands for, both cases and the base
 * itself included: `e` → `eEéÉèÈêÊëË…`.
 *
 * Built from Latin-1 Supplement and Latin Extended-A by {@link foldText}
 * itself, rather than typed out, so a letter folds in the table exactly when
 * it folds in the rule. Both cases are listed explicitly so a pattern built
 * from it never depends on how a regex engine case-folds outside ASCII.
 */
export const FOLD_TABLE: Readonly<Record<string, string>> = (() => {
  const table: Record<string, string> = {};
  for (let code = 0xc0; code <= 0x17f; code += 1) {
    const letter = String.fromCharCode(code);
    const base = foldText(letter);
    if (base === letter || !/^[a-z]$/.test(base)) continue;
    table[base] ??= `${base}${base.toUpperCase()}`;
    table[base] += letter;
  }
  return table;
})();

/** Escapes a string so it is matched literally inside a regular expression. */
export const escapeRegex = (value: string): string =>
  value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * A regular expression source that matches `value` as a substring the way
 * `like` does, for an engine that cannot fold the text it searches: the value
 * is folded, and each letter that has accented forms becomes a class of all of
 * them, so `cafe` matches `Café` and `CAFÉ`. Everything else is escaped, so a
 * `.` or a `(` in a search is matched literally.
 */
export const foldedPattern = (value: string): string =>
  Array.from(foldText(value))
    .map(char => {
      const forms = FOLD_TABLE[char];
      return forms === undefined ? escapeRegex(char) : `[${forms}]`;
    })
    .join('');

/** Whether `actual` contains `value`, both folded. */
export const containsFolded = (actual: string, value: string): boolean =>
  foldText(actual).includes(foldText(value));
