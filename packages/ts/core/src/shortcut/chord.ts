/** A keyboard chord, read: `"Mod+Shift+S"` as its parts. */
export interface ParsedChord {
  /** The chord as written, normalized: `Mod`, then `Alt`, then `Shift`. */
  readonly text: string;
  /** `KeyboardEvent.key`, lower-cased. */
  readonly key: string;
  readonly shift: boolean;
  readonly alt: boolean;
}

/**
 * The chords that belong to whatever field has focus: select all, copy, paste,
 * cut, undo and redo. A shortcut on one of them would take an edit away from
 * the reader mid-sentence.
 */
const EDITING_KEYS = new Set(['a', 'c', 'v', 'x', 'y', 'z']);

const MODIFIERS = new Set(['mod', 'shift', 'alt']);

/**
 * Reads a chord, refusing one a shortcut may not take (ADR 0026):
 *
 * - **without `Mod`** — a single key, or Shift+key, fires while a reader
 *   types (WCAG 2.1.4);
 * - **Alt+letter** — macOS Option composes it into a character;
 * - **an editing chord** — Mod+A, C, V, X, Y, Z are the field's.
 *
 * `Mod` is ⌘ on a Mac and Ctrl elsewhere.
 */
export function parseChord(chord: string): ParsedChord {
  const parts = chord.split('+').map(part => part.trim());
  // `split` always yields a last part, empty for `"Mod+"`.
  const last = parts[parts.length - 1] as string;
  const key = last.toLowerCase();
  const modifiers = new Set(parts.slice(0, -1).map(part => part.toLowerCase()));
  const refuse = (why: string): never => {
    throw new Error(`"${chord}" cannot be a shortcut: ${why}.`);
  };

  if (key === '' || MODIFIERS.has(key)) refuse('it names no key');
  for (const modifier of modifiers)
    if (!MODIFIERS.has(modifier))
      refuse(`"${modifier}" is not Mod, Alt or Shift`);
  if (!modifiers.has('mod'))
    refuse('a shortcut holds Mod, so it never fires while someone types');
  if (modifiers.has('alt') && /^[a-z]$/.test(key))
    refuse('Option+letter types a character on macOS');
  if (!modifiers.has('alt') && !modifiers.has('shift') && EDITING_KEYS.has(key))
    refuse('it is an editing chord a text field needs');

  const shift = modifiers.has('shift');
  const alt = modifiers.has('alt');
  const display = key.length === 1 ? key.toUpperCase() : last;
  return {
    text: [
      'Mod',
      ...(alt ? ['Alt'] : []),
      ...(shift ? ['Shift'] : []),
      display,
    ].join('+'),
    key,
    shift,
    alt,
  };
}

/** Throws unless `chord` is one a shortcut may take; see {@link parseChord}. */
export function assertChord(chord: string): void {
  parseChord(chord);
}
