/**
 * The documents these checks hold, and the small readers they share.
 *
 * Deliberately narrow. The version of this project in the repository entifix
 * was extracted from also asserted a store register, a port table and an
 * entity-name scan — facts about one fleet, none of which exist here. What survives the move is the part that is
 * true of any documentation set: a link that resolves, a record that carries
 * its own index headers, and a supersession that points both ways.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { ENTIFIX_AREAS, readRecords } from '@entifix/docs/reader';

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
 * The areas a record can be filed under: the reader's own list, so the check
 * and the package that ships the index agree on one.
 */
export const ADR_AREAS = ENTIFIX_AREAS;

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

/**
 * What the one parser, `@entifix/docs/reader`, says is wrong with the
 * collection: a record missing a header, filed under an unknown area, numbered
 * twice or superseded by a record that does not exist.
 */
export const adrProblems = (): readonly string[] =>
  readRecords(ADR_ROOT, { areas: ADR_AREAS }).problems;

/** Every record, its fields read by `@entifix/docs/reader`, its text kept. */
export const adrRecords = (): AdrRecord[] => {
  const { records } = readRecords(ADR_ROOT, { areas: ADR_AREAS });
  return records.map(record => ({
    file: record.file,
    id: record.id,
    title: `${record.number}. ${record.title}`,
    status: record.status,
    text: read('docs', 'adr', record.file),
    area: record.area,
    readWhen: record.readWhen,
  }));
};
