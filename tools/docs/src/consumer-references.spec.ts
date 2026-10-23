import { describe, expect, it } from 'vitest';

import {
  findConsumerReferences,
  ownRecordNumbers,
  trackedFiles,
} from './consumer-references.js';
import { read } from './corpus.js';

const RECORDS = new Set(['0001', '0006', '0007']);
const RECORD_FILES = new Set(['0001-the-tier-contract-and-the-host-seam.md']);

const rules = (path: string, text: string) =>
  findConsumerReferences(path, text, RECORDS, RECORD_FILES).map(
    found => found.rule,
  );

describe('No reference into the repository entifix was extracted from', () => {
  const files = trackedFiles();

  // Same guard as every scan here: one that silently stops matching would make
  // the sweep below pass while checking nothing.
  it('finds the files it is meant to check', () => {
    expect(files.length).toBeGreaterThan(500);
    expect(files).toContain('packages/ts/core/src/index.ts');
    expect(files).toContain(
      'docs/adr/0001-the-tier-contract-and-the-host-seam.md',
    );
    expect(ownRecordNumbers().has('0001')).toBe(true);
  });

  it.each(files)('%s', path => {
    expect(
      findConsumerReferences(path, read(path), ownRecordNumbers()),
    ).toEqual([]);
  });
});

/**
 * Each rule against planted input, paired with what it must let through — so
 * neither a rule that never matches nor one that matches everything can pass.
 */
describe('the rules', () => {
  describe('source names no consumer', () => {
    it('refuses the name in a comment, a package name and an env var', () => {
      expect(rules('packages/ts/core/src/a.ts', ' * as r10c does')).toEqual([
        'names-consumer',
      ]);
      expect(
        rules('packages/ts/core/src/a.ts', "import '@r10c/slices';"),
      ).toEqual(['names-consumer']);
      expect(rules('tools/dev/a.sh', 'R10C_URL=x')).toEqual(['names-consumer']);
    });

    it("lets the repository's own URL through", () => {
      expect(
        rules(
          'packages/ts/core/package.json',
          '"url": "git+https://github.com/r10c-technologies/entifix.git"',
        ),
      ).toEqual([]);
    });

    it('lets the copyright line through in a licence and nowhere else', () => {
      const line = 'Copyright (c) 2026 r10c Technologies';
      expect(rules('packages/ts/core/LICENSE', line)).toEqual([]);
      expect(rules('packages/ts/core/src/a.ts', line)).toEqual([
        'names-consumer',
      ]);
    });

    it('does not apply to the documents, which may tell the history', () => {
      expect(rules('docs/adr/0001-x.md', 'extracted from r10c')).toEqual([]);
    });
  });

  describe('a record number is ours', () => {
    it('refuses a number this collection does not hold', () => {
      expect(rules('packages/ts/core/src/a.ts', ' * (ADR 0030)')).toEqual([
        'foreign-record',
      ]);
      expect(rules('docs/adr/0001-x.md', 'see ADR 0030')).toEqual([
        'foreign-record',
      ]);
    });

    it('lets a number it holds through', () => {
      expect(rules('packages/ts/core/src/a.ts', ' * (ADR 0006)')).toEqual([]);
    });

    it('allows an attributed foreign record in docs, and never in source', () => {
      expect(rules('docs/adr/0001-x.md', "as r10c's ADR 0059")).toEqual([]);
      expect(rules('packages/ts/core/src/a.ts', " * r10c's ADR 0059")).toEqual([
        'names-consumer',
        'foreign-record',
      ]);
    });
  });

  describe('a link into docs/adr resolves', () => {
    it('refuses a link to a record that is not here', () => {
      expect(
        rules(
          'packages/ts/core/src/a.ts',
          ' * ([the record](../../../../docs/adr/0036-the-reactive-stream.md))',
        ),
      ).toEqual(['dead-record-link']);
    });

    it('lets a link to a record that is here through', () => {
      expect(
        rules(
          'packages/ts/core/src/a.ts',
          ' * [ADR 0001](../../../../docs/adr/0001-the-tier-contract-and-the-host-seam.md)',
        ),
      ).toEqual([]);
    });
  });

  it('exempts only its own two files', () => {
    expect(
      findConsumerReferences(
        'tools/docs/src/consumer-references.spec.ts',
        'r10c ADR 0030',
        RECORDS,
      ),
    ).toEqual([]);
    expect(rules('tools/docs/src/corpus.ts', 'r10c')).toEqual([
      'names-consumer',
    ]);
  });
});
