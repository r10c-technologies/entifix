import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { readRecords } from './read-records.js';

const AREAS = ['platform', 'ui'];

const collection = (files: Record<string, string>): string => {
  const directory = mkdtempSync(join(tmpdir(), 'entifix-docs-'));
  for (const [name, text] of Object.entries(files)) {
    writeFileSync(join(directory, name), text);
  }
  return directory;
};

const record = (
  number: number,
  headers: Record<string, string> = {},
  body = '## Decision\n\nWe decide.\n',
): string => {
  const all = {
    Status: 'Accepted',
    Date: '2026-11-17',
    Area: 'platform',
    'Read when': 'a thing breaks',
    ...headers,
  };
  const lines = Object.entries(all)
    .filter(([, value]) => value !== undefined)
    .map(([key, value]) => `- ${key}: ${value}`);
  return `# ${number}. Title ${number}\n\n${lines.join('\n')}\n\n${body}`;
};

describe('readRecords', () => {
  it('reads a record into its index entry', () => {
    const directory = collection({
      '0001-first.md': record(1, { Revised: '2026-11-18 by ADR 0002' }),
      'README.md': '# Records\n',
      'notes.txt': 'not a record',
    });

    const { records, problems } = readRecords(directory, { areas: AREAS });

    expect(problems).toEqual([]);
    expect(records).toEqual([
      {
        id: '0001',
        number: 1,
        file: '0001-first.md',
        title: 'Title 1',
        status: 'accepted',
        date: '2026-11-17',
        area: 'platform',
        readWhen: 'a thing breaks',
        revisions: 1,
        points: ['We decide.'],
        supersedes: [],
      },
    ]);
  });

  it('folds a wrapped header line into one', () => {
    const directory = collection({
      '0001-first.md':
        '# 1. T\n\n- Status: Accepted\n- Date: 2026-11-17\n- Area: ui\n- Read when: one\n  and two\n\n## Decision\n\nDone.\n',
    });

    const { records } = readRecords(directory, { areas: AREAS });

    expect(records[0]?.readWhen).toBe('one and two');
  });

  it('knows the four statuses, and the record that replaced one', () => {
    const directory = collection({
      '0001-a.md': record(1, { Status: 'Superseded by [ADR 0002](0002-b.md)' }),
      '0002-b.md': record(2, { Status: 'Proposed' }),
      '0003-c.md': record(3, {
        Status: 'Superseded in part by [ADR 0002](0002-b.md)',
      }),
      '0004-d.md': record(4, { Status: 'Superseded' }),
      '0005-e.md': record(5, { Status: 'Superseded in part' }),
    });

    const { records, problems } = readRecords(directory, { areas: AREAS });
    const by = (id: string) => records.find(entry => entry.id === id);

    expect(problems).toEqual([]);
    expect(by('0001')).toMatchObject({
      status: 'superseded',
      supersededBy: '0002',
    });
    expect(by('0003')).toMatchObject({
      status: 'superseded-in-part',
      supersededBy: '0002',
    });
    expect(by('0004')?.supersededBy).toBeUndefined();
    expect(by('0005')?.status).toBe('superseded-in-part');
    expect(by('0002')).toMatchObject({
      status: 'proposed',
      supersedes: ['0001', '0003'],
    });
  });

  it('reports a heading that is not a numbered title', () => {
    const directory = collection({ '0001-a.md': 'Title\n' });

    expect(readRecords(directory, { areas: AREAS }).problems).toEqual([
      '0001-a.md: the first line is not "# N. Title"',
    ]);
  });

  it('reports a heading that disagrees with its file name', () => {
    const directory = collection({ '0001-a.md': record(2) });

    expect(readRecords(directory, { areas: AREAS }).problems).toEqual([
      '0001-a.md: the heading numbers it 2',
    ]);
  });

  it('reports a missing header, and an empty one', () => {
    const directory = collection({
      '0001-a.md':
        '# 1. T\n\n- Status: Accepted\n- Date: x\n- Area: ui\n\nBody\n',
      '0002-b.md': '# 2. T\n\n- Date: x\n- Area: ui\n- Read when: y\n',
      '0003-c.md': '# 3. T\n\n- Status: Accepted\n- Read when: y\n',
    });

    expect(readRecords(directory, { areas: AREAS }).problems).toEqual([
      '0001-a.md: no "- Read when:" line',
      '0002-b.md: no "- Status:" line',
      '0003-c.md: no "- Date:" line',
      '0003-c.md: no "- Area:" line',
    ]);
  });

  it('reports an area the host did not declare', () => {
    const directory = collection({ '0001-a.md': record(1, { Area: 'misc' }) });

    expect(readRecords(directory, { areas: AREAS }).problems).toEqual([
      '0001-a.md: area "misc" is not one of platform, ui',
    ]);
  });

  it('reports a status it does not know, and drops the record', () => {
    const directory = collection({
      '0001-a.md': record(1, { Status: 'Draft' }),
    });

    const { records, problems } = readRecords(directory, { areas: AREAS });

    expect(records).toEqual([]);
    expect(problems).toEqual([
      '0001-a.md: a status this reader does not know: Draft',
    ]);
  });

  it('reports a number used twice, and a replacement that does not exist', () => {
    const directory = collection({
      '0001-a.md': record(1, { Status: 'Superseded by [ADR 0009](0009-z.md)' }),
      '0001-b.md': record(1),
    });

    expect(readRecords(directory, { areas: AREAS }).problems).toEqual([
      '0001-b.md: number 0001 is used twice',
      '0001-a.md: superseded by ADR 0009, which does not exist',
    ]);
  });

  it('reads a collection with a header block that ends the file', () => {
    const directory = collection({
      '0001-a.md':
        '# 1. T\n\n- Status: Accepted\n- Date: x\n- Area: ui\n- Read when: y',
    });

    const { records, problems } = readRecords(directory, { areas: AREAS });

    expect(problems).toEqual([]);
    expect(records[0]?.points).toEqual([]);
  });

  it('reads an empty directory', () => {
    const directory = collection({});
    mkdirSync(join(directory, 'sub'));

    expect(readRecords(directory, { areas: AREAS })).toEqual({
      records: [],
      problems: [],
    });
  });
});
