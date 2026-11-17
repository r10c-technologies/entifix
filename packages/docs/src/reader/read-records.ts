import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { pointsOf } from './points.js';

/** Where a record stands, as its `- Status:` line says. */
export type RecordStatus =
  'accepted' | 'proposed' | 'superseded' | 'superseded-in-part';

/** One record, as the index carries it. */
export interface RecordEntry {
  /** The four-digit number, as written in the file name: `0031`. */
  readonly id: string;
  readonly number: number;
  /** The file name, `0031-the-title.md`. */
  readonly file: string;
  readonly title: string;
  readonly status: RecordStatus;
  /** The record that replaced this one, when its status names one. */
  readonly supersededBy?: string;
  /** The records whose status names this one as their replacement. */
  readonly supersedes: readonly string[];
  readonly date: string;
  readonly area: string;
  /** The `- Read when:` header: the symptom that should send a reader here. */
  readonly readWhen: string;
  /** How many `- Revised:` lines the record carries. */
  readonly revisions: number;
  /** The decision, in at most five lines. */
  readonly points: readonly string[];
}

export interface ReadOptions {
  /**
   * The areas a record may be filed under. A parameter, because a host files
   * records under areas the framework does not have.
   */
  readonly areas: readonly string[];
}

export interface ReadResult {
  /** The records that could be read, in file order. */
  readonly records: readonly RecordEntry[];
  /** What is wrong with the collection, one line each: `file: what`. */
  readonly problems: readonly string[];
}

const RECORD_FILE = /^(\d{4})-.*\.md$/;
const HEADER = /^- ([A-Za-z ]+): (.*)$/;
const RECORD_LINK = /\[ADR (\d{4})\]/;
const REQUIRED = ['Status', 'Date', 'Area', 'Read when'] as const;

const statusOf = (
  line: string,
): { status: RecordStatus; by?: string } | undefined => {
  const text = line.toLowerCase();
  const by = RECORD_LINK.exec(line)?.[1];
  if (text.startsWith('superseded in part')) {
    return by === undefined
      ? { status: 'superseded-in-part' }
      : { status: 'superseded-in-part', by };
  }
  if (text.startsWith('superseded')) {
    return by === undefined
      ? { status: 'superseded' }
      : { status: 'superseded', by };
  }
  if (text.startsWith('accepted')) return { status: 'accepted' };
  if (text.startsWith('proposed')) return { status: 'proposed' };
  return undefined;
};

/** The header lines after the title, a wrapped one folded into one. */
const headersOf = (
  lines: readonly string[],
): { fields: Map<string, string>; revisions: number; rest: string } => {
  const fields = new Map<string, string>();
  let revisions = 0;
  let index = 1;
  while (index < lines.length && (lines[index] as string).trim() === '')
    index += 1;
  for (; index < lines.length; index += 1) {
    let line = lines[index] as string;
    if (!HEADER.test(line)) break;
    while (/^ {2,}\S/.test(lines[index + 1] ?? '')) {
      index += 1;
      line = `${line} ${(lines[index] as string).trim()}`;
    }
    const [, key, value] = HEADER.exec(line) as RegExpExecArray;
    if (key === 'Revised') revisions += 1;
    else fields.set(key as string, (value as string).trim());
  }
  return { fields, revisions, rest: lines.slice(index).join('\n').trim() };
};

/**
 * Reads a collection of decision records, `NNNN-*.md` in one directory (a
 * `README.md` beside them is not a record), and answers the index and
 * whatever is wrong with it.
 *
 * The format is the one `docs/adr/README.md` describes: a `# N. Title`
 * heading, then `- Status:`, `- Date:`, `- Area:` and `- Read when:` lines.
 */
export const readRecords = (
  directory: string,
  options: ReadOptions,
): ReadResult => {
  const problems: string[] = [];
  const read: { entry: Omit<RecordEntry, 'supersedes'>; by?: string }[] = [];
  const files = readdirSync(directory)
    .filter(file => RECORD_FILE.test(file))
    .sort();

  for (const file of files) {
    const lines = readFileSync(join(directory, file), 'utf8').split('\n');
    const heading = /^# (\d+)\. (.+)$/.exec(lines[0] as string);
    if (heading === null) {
      problems.push(`${file}: the first line is not "# N. Title"`);
      continue;
    }
    const id = file.slice(0, 4);
    const number = Number(heading[1]);
    if (number !== Number(id)) {
      problems.push(`${file}: the heading numbers it ${number}`);
    }

    const { fields, revisions, rest } = headersOf(lines);
    const missing = REQUIRED.filter(name => (fields.get(name) ?? '') === '');
    for (const name of missing) problems.push(`${file}: no "- ${name}:" line`);

    const area = fields.get('Area') ?? '';
    if (area !== '' && !options.areas.includes(area)) {
      problems.push(
        `${file}: area "${area}" is not one of ${options.areas.join(', ')}`,
      );
    }

    const status = statusOf(fields.get('Status') ?? '');
    if (status === undefined && !missing.includes('Status')) {
      problems.push(
        `${file}: a status this reader does not know: ${fields.get('Status')}`,
      );
    }
    if (status === undefined) continue;

    read.push({
      entry: {
        id,
        number,
        file,
        title: (heading[2] as string).trim(),
        status: status.status,
        ...(status.by === undefined ? {} : { supersededBy: status.by }),
        date: fields.get('Date') ?? '',
        area,
        readWhen: fields.get('Read when') ?? '',
        revisions,
        points: pointsOf(rest),
      },
      ...(status.by === undefined ? {} : { by: status.by }),
    });
  }

  const ids = new Set(read.map(each => each.entry.id));
  const seen = new Set<string>();
  for (const { entry } of read) {
    if (seen.has(entry.id))
      problems.push(`${entry.file}: number ${entry.id} is used twice`);
    seen.add(entry.id);
  }
  for (const { entry, by } of read) {
    if (by !== undefined && !ids.has(by)) {
      problems.push(
        `${entry.file}: superseded by ADR ${by}, which does not exist`,
      );
    }
  }

  const records = read.map(({ entry }) => ({
    ...entry,
    supersedes: read
      .filter(other => other.by === entry.id)
      .map(other => other.entry.id),
  }));
  return { records, problems };
};
