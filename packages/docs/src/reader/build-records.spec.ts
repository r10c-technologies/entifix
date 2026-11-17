import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { buildRecords } from './build-records.js';

const AREAS = ['platform'];
const text = (n: number): string =>
  `# ${n}. T\n\n- Status: Accepted\n- Date: x\n- Area: platform\n- Read when: y\n\n## Decision\n\nDone.\n`;

const workspace = (files: Record<string, string>) => {
  const root = mkdtempSync(join(tmpdir(), 'entifix-docs-build-'));
  const from = join(root, 'adr');
  const into = join(root, 'out');
  mkdirSync(from);
  mkdirSync(into);
  for (const [name, body] of Object.entries(files)) {
    writeFileSync(join(from, name), body);
  }
  return { from, into };
};

describe('buildRecords', () => {
  it('copies the records and the README and writes the index', () => {
    const { from, into } = workspace({
      '0001-a.md': text(1),
      'README.md': '# R\n',
      'other.md': '# not shipped\n',
    });

    const result = buildRecords(from, into, { areas: AREAS });

    expect(result.problems).toEqual([]);
    expect(readFileSync(join(into, 'records', '0001-a.md'), 'utf8')).toBe(
      text(1),
    );
    expect(existsSync(join(into, 'records', 'README.md'))).toBe(true);
    expect(existsSync(join(into, 'records', 'other.md'))).toBe(false);
    const index = JSON.parse(readFileSync(join(into, 'records.json'), 'utf8'));
    expect(index).toHaveLength(1);
    expect(index[0].id).toBe('0001');
  });

  it('replaces what an earlier build left', () => {
    const { from, into } = workspace({ '0001-a.md': text(1) });
    buildRecords(from, into, { areas: AREAS });
    writeFileSync(join(into, 'records', 'stale.md'), 'old');

    buildRecords(from, into, { areas: AREAS });

    expect(existsSync(join(into, 'records', 'stale.md'))).toBe(false);
  });

  it('writes nothing when the collection has problems', () => {
    const { from, into } = workspace({ '0001-a.md': 'broken' });

    const result = buildRecords(from, into, { areas: AREAS });

    expect(result.problems).toHaveLength(1);
    expect(existsSync(join(into, 'records'))).toBe(false);
    expect(existsSync(join(into, 'records.json'))).toBe(false);
  });
});
