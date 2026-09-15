import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { ADR_AREAS, adrRecords, allDocs, read, REPO_ROOT } from './corpus.js';

/** `[text](target)` — relative markdown links only; http(s) and mailto are not ours to check. */
const LINK = /\[[^\]]*\]\(([^)\s]+)\)/g;

/**
 * Link extraction skips fenced code blocks. A record showing the *shape* of a
 * supersession line writes `[ADR 00XX](00XX-….md)` inside a fence, and a check
 * that cannot tell a specimen from a link reports the placeholder as broken —
 * which teaches the next author to stop writing specimens.
 */
const withoutFences = (text: string): string =>
  text.replace(/```[\s\S]*?```/g, '');

/** A GitHub-style anchor for a heading: lowercased, punctuation dropped, spaces to dashes. */
const slug = (heading: string): string =>
  heading
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, '')
    .replace(/\s+/g, '-');

const headingSlugs = (text: string): Set<string> =>
  new Set([...text.matchAll(/^#{1,6}\s+(.+)$/gm)].map(match => slug(match[1])));

describe('Links resolve', () => {
  it.each(allDocs())('%s', doc => {
    const text = withoutFences(read(doc));
    const broken: string[] = [];

    for (const [, target] of text.matchAll(LINK)) {
      if (/^(https?:|mailto:|#)/.test(target)) continue;
      const [path, anchor] = target.split('#');
      const absolute = resolve(REPO_ROOT, dirname(doc), path);
      if (!existsSync(absolute)) {
        broken.push(`${target} — no such file`);
        continue;
      }
      if (anchor !== undefined && absolute.endsWith('.md')) {
        const slugs = headingSlugs(
          read(...absolute.slice(REPO_ROOT.length + 1).split('/')),
        );
        if (!slugs.has(anchor)) broken.push(`${target} — no such heading`);
      }
    }

    expect(broken).toEqual([]);
  });

  it.each(allDocs())('%s — its own anchors', doc => {
    const text = withoutFences(read(doc));
    const slugs = headingSlugs(read(doc));
    const broken = [...text.matchAll(LINK)]
      .map(match => match[1])
      .filter(target => target.startsWith('#') && !slugs.has(target.slice(1)));

    expect(broken).toEqual([]);
  });
});

describe('Every record carries the headers an index is built from', () => {
  const records = adrRecords();

  it('finds the records it is meant to check', () => {
    expect(records.length).toBeGreaterThan(0);
  });

  it.each(records.map(r => [r.file, r] as const))('%s', (_file, record) => {
    expect(record.title).not.toBe('');
    expect(record.status).not.toBe('');
    // `- Area:` and `- Read when:` are what a router's decision index is
    // generated from. A record missing either cannot be indexed, and an
    // unindexed record is one nobody reads before designing in its area.
    expect(ADR_AREAS).toContain(record.area);
    expect(record.readWhen).not.toBe('');
  });

  it('numbers each record once, and agrees with its own heading', () => {
    const ids = records.map(r => r.id);
    expect(new Set(ids).size).toBe(ids.length);

    for (const record of records) {
      expect(record.title).toMatch(new RegExp(`^${Number(record.id)}\\. `));
    }
  });
});

/**
 * Supersession is symmetric, and it is the rule most easily missed: writing it
 * only forward leaves a reader who opens the old record seeing `Accepted` and
 * no marker.
 */
describe('Supersession is symmetric', () => {
  const records = adrRecords();
  const byId = new Map(records.map(record => [record.id, record]));

  const claims = (record: { text: string }): string[] =>
    [...record.text.matchAll(/supersedes\s+\[?ADR\s+(\d{4})/gi)].map(m => m[1]);

  it.each(records.map(r => [r.file, r] as const))(
    '%s names a record that names it back',
    (_file, record) => {
      const missing = claims(record).filter(id => {
        const target = byId.get(id);
        if (target === undefined) return true;
        return !new RegExp(`superseded by \\[?ADR ${record.id}`, 'i').test(
          target.text,
        );
      });

      expect(missing).toEqual([]);
    },
  );
});
