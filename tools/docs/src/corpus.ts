/**
 * The documents these checks hold, and the small readers they share.
 *
 * Deliberately narrow. r10c's version of this project also asserted a store
 * register, a port table and an entity-name scan — facts about a marketplace
 * fleet, none of which exist here. What survives the move is the part that is
 * true of any documentation set: a link that resolves, a record that carries
 * its own index headers, and a supersession that points both ways.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export const REPO_ROOT = join(import.meta.dirname, '..', '..', '..');
export const DOCS_ROOT = join(REPO_ROOT, 'docs');
export const ADR_ROOT = join(DOCS_ROOT, 'adr');

export const read = (...parts: string[]): string =>
  readFileSync(join(REPO_ROOT, ...parts), 'utf8');

/** `docs/adr/NNNN-*.md`, sorted. Excludes the README. */
export const adrFiles = (): string[] =>
  readdirSync(ADR_ROOT)
    .filter(file => /^\d{4}-.*\.md$/.test(file))
    .sort();

/** Every markdown file these checks read, as repo-relative paths. */
export const allDocs = (): string[] => [
  'README.md',
  // The assistant router. Its links are what send a reader to a record, so a
  // stale one is exactly the drift this check exists for.
  'CLAUDE.md',
  join('docs', 'adr', 'README.md'),
  ...adrFiles().map(name => join('docs', 'adr', name)),
];

/**
 * The areas a record can be filed under, in the order an index would render
 * them.
 *
 * A fixed list rather than free text, because the value is a grouping key: one
 * record filed under `adapters` and another under `Adapters` would render two
 * sections that look like two subjects.
 */
export const ADR_AREAS = [
  'entities',
  'adapters',
  'ui',
  'platform',
  'testing',
] as const;

export type AdrArea = (typeof ADR_AREAS)[number];

export interface AdrRecord {
  readonly file: string;
  /** The four-digit number, as written: `0001`. */
  readonly id: string;
  readonly title: string;
  readonly status: string;
  readonly text: string;
  /** The `- Area:` header — the section this record is indexed under. */
  readonly area: string;
  /**
   * The `- Read when:` header: the symptom that should send a reader here.
   *
   * A line naming the record's *subject* gets skipped; one naming the
   * **symptom** gets read, which is the difference between an index and a
   * digest.
   */
  readonly readWhen: string;
}

const header = (text: string, name: string): string => {
  const match = new RegExp(`^- ${name}:\\s*(.+(?:\\n  .+)*)$`, 'm').exec(text);
  return match === null ? '' : match[1].replace(/\n\s+/g, ' ').trim();
};

export const adrRecords = (): AdrRecord[] =>
  adrFiles().map(file => {
    const text = read('docs', 'adr', file);
    return {
      file,
      id: file.slice(0, 4),
      title: (/^# .*$/m.exec(text) ?? [''])[0].replace(/^# /, ''),
      status: header(text, 'Status'),
      text,
      area: header(text, 'Area'),
      readWhen: header(text, 'Read when'),
    };
  });
