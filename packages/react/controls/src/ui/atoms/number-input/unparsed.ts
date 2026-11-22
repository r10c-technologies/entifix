/** U+2060, a word joiner: invisible, and never part of a number. */
const MARK = '\u2060';

/**
 * The draft for text an input could not read as its number: the text itself,
 * kept so it can be shown again. Text that `Number` would still read — `12.5`
 * typed where only whole units exist — is marked, or validation would let it
 * through and store it as if it were already in the stored unit.
 */
export const unparsedDraft = (text: string): string =>
  text.trim() === ''
    ? ''
    : Number.isNaN(Number(text))
      ? text
      : `${MARK}${text}`;

/** What was typed, out of a draft {@link unparsedDraft} made. */
export const typedText = (draft: string): string => draft.replace(MARK, '');
