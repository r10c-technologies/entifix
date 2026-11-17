/**
 * The areas entifix's own records are filed under, in the order an index would
 * render them.
 *
 * A fixed list rather than free text, because the value is a grouping key: one
 * record filed under `adapters` and another under `Adapters` would render two
 * sections that look like two subjects. A host reading its own collection
 * passes its own list to `readRecords`.
 */
export const ENTIFIX_AREAS = [
  'entities',
  'adapters',
  'ui',
  'platform',
  'testing',
] as const;
