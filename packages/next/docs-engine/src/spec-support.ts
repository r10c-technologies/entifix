import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

/** A directory holding `files`, nested by their paths. */
export const directoryOf = (files: Record<string, string>): string => {
  const directory = mkdtempSync(join(tmpdir(), 'docs-engine-'));
  for (const [name, text] of Object.entries(files)) {
    mkdirSync(dirname(join(directory, name)), { recursive: true });
    writeFileSync(join(directory, name), text);
  }
  return directory;
};

/** A record in entifix's format. */
export const record = (
  number: number,
  body = '## Decision\n\nWe decide.\n',
  area = 'platform',
): string =>
  `# ${number}. Title ${number}\n\n- Status: Accepted\n- Date: 2026-11-17\n- Area: ${area}\n- Read when: a thing breaks\n\n${body}`;

export const guide = (title: string, body: string, extra = ''): string =>
  `---\ntitle: ${title}\n${extra}---\n\n${body}`;
