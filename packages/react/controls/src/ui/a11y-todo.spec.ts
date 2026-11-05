import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * `a11y-todo.json` is the accessibility gate's ratchet (ADR 0024): a story
 * title listed there still renders and is still audited, but its violations
 * are reported rather than failing `test-a11y`. An entry is only honest while
 * it names the issue that removes it and a story that still exists.
 */
const PACKAGE = join(import.meta.dirname, '..', '..');

const TODO: Record<string, string> = JSON.parse(
  readFileSync(join(PACKAGE, 'a11y-todo.json'), 'utf8'),
);

/** This repository, as GitHub names it across repositories. */
const REPOSITORY = 'r10c-technologies/entifix';

/** An issue in this repository, in the form GitHub links across repos. */
const ISSUE = new RegExp(`^${REPOSITORY}#\\d+$`);

const storyTitles = (dir: string): string[] =>
  readdirSync(dir, { recursive: true, encoding: 'utf8' })
    .filter(file => file.endsWith('.stories.tsx'))
    .flatMap(file => {
      const title = /title: '([^']+)'/.exec(
        readFileSync(join(dir, file), 'utf8'),
      )?.[1];
      return title === undefined ? [] : [title];
    });

describe('the accessibility todo list', () => {
  it('names the issue that removes every entry', () => {
    const malformed = Object.entries(TODO).filter(
      ([, issue]) => !ISSUE.test(issue),
    );
    expect(malformed).toEqual([]);
  });

  it('lists only stories that exist', () => {
    const titles = new Set(storyTitles(join(PACKAGE, 'src')));
    expect(Object.keys(TODO).filter(title => !titles.has(title))).toEqual([]);
  });
});
