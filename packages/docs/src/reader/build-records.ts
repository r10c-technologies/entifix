import {
  copyFileSync,
  mkdirSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';

import type { ReadOptions, RecordEntry } from './read-records.js';
import { readRecords } from './read-records.js';

export interface BuildResult {
  readonly records: readonly RecordEntry[];
  readonly problems: readonly string[];
}

/**
 * Writes what a package ships from a collection: every record and the README
 * into `<into>/records/`, and the index as `<into>/records.json`.
 *
 * Nothing is written when the collection has problems, so a malformed record
 * fails the build that would have published it.
 */
export const buildRecords = (
  from: string,
  into: string,
  options: ReadOptions,
): BuildResult => {
  const result = readRecords(from, options);
  if (result.problems.length > 0) return result;

  const target = join(into, 'records');
  rmSync(target, { recursive: true, force: true });
  mkdirSync(target, { recursive: true });
  for (const file of readdirSync(from)) {
    if (/^(\d{4}-.*|README)\.md$/.test(file)) {
      copyFileSync(join(from, file), join(target, file));
    }
  }
  writeFileSync(
    join(into, 'records.json'),
    `${JSON.stringify(result.records, null, 2)}\n`,
  );
  return result;
};
