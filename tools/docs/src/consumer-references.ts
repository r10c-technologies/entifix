/**
 * No reference into the repository entifix was extracted from.
 *
 * entifix began inside its first consumer, and its source arrived citing that
 * repository's decision records by number — 337 of them, plus its issues and
 * its tool names. A citation of that kind is a dead reference for every reader
 * who cannot open the other repository, and it is worse than dead when the
 * number is also one of ours: that repository's records 0001–0007 share numbers
 * with this collection, so an old "ADR 0007" in a comment names a record about
 * something else entirely and reads as if it were right.
 *
 * Stated once, the rule would be skipped by the next comment written in a
 * hurry, so it is checked instead. Three rules, against every tracked file:
 *
 * 1. **Source names no consumer.** Nothing under `packages/`, `examples/` or
 *    `tools/` contains the word, once the repository's own URL and a licence's
 *    copyright line are set aside — those name the organization that owns
 *    entifix, not a consumer of it.
 * 2. **A record number is ours.** `ADR NNNN` anywhere must name a file in
 *    `docs/adr/`. The documents may still tell the history, so an explicitly
 *    attributed "r10c's ADR 0059" is allowed there and only there.
 * 3. **A link into `docs/adr/` resolves**, from source as well as from docs.
 */
import { execFileSync } from 'node:child_process';
import { readdirSync } from 'node:fs';

import { ADR_ROOT, adrFiles, REPO_ROOT } from './corpus.js';

const CONSUMER = /r10c/i;
const OWN_URL = /r10c-technologies\/entifix/gi;
/** The copyright holder in a licence is the owning organization's name. */
const COPYRIGHT = /^Copyright \(c\) \d{4} r10c Technologies$/gm;
const RECORD = /(r10c(?:'s)? )?ADR (\d{4})/g;
const RECORD_LINK = /\]\((?:\.\.\/|\.\/)*(?:docs\/)?adr\/([^)\s#]+)\)/g;

/** The two files that have to spell the word to test it. */
const SELF = new Set([
  'tools/docs/src/consumer-references.ts',
  'tools/docs/src/consumer-references.spec.ts',
]);

const SOURCE_ROOTS = ['packages/', 'examples/', 'tools/'];
const isSource = (path: string): boolean =>
  SOURCE_ROOTS.some(root => path.startsWith(root));
const isLicence = (path: string): boolean => /(^|\/)LICENSE$/.test(path);

export interface ConsumerReference {
  readonly line: number;
  readonly rule: 'names-consumer' | 'foreign-record' | 'dead-record-link';
  readonly text: string;
}

/** The record numbers this collection holds, `0001`, `0002`, … */
export const ownRecordNumbers = (): ReadonlySet<string> =>
  new Set(adrFiles().map(file => file.slice(0, 4)));

/**
 * Every violation in one file's text. Pure, so the rules can be proved against
 * planted input rather than only against a tree that happens to be clean.
 */
export const findConsumerReferences = (
  path: string,
  text: string,
  records: ReadonlySet<string>,
  recordFiles: ReadonlySet<string> = new Set(readdirSync(ADR_ROOT)),
): ConsumerReference[] => {
  if (SELF.has(path)) return [];
  const found: ConsumerReference[] = [];
  const source = isSource(path);

  text.split('\n').forEach((raw, index) => {
    const line = index + 1;
    const report = (rule: ConsumerReference['rule']) =>
      found.push({ line, rule, text: raw.trim().slice(0, 120) });

    if (source) {
      let stripped = raw.replace(OWN_URL, '');
      if (isLicence(path)) stripped = stripped.replace(COPYRIGHT, '');
      if (CONSUMER.test(stripped)) report('names-consumer');
    }

    for (const match of raw.matchAll(RECORD)) {
      const attributed = match[1] !== undefined;
      if (attributed && !source) continue;
      if (attributed || !records.has(match[2])) report('foreign-record');
    }

    for (const match of raw.matchAll(RECORD_LINK)) {
      if (!recordFiles.has(match[1])) report('dead-record-link');
    }
  });

  return found;
};

/** Text files git tracks under the paths these rules cover. */
export const trackedFiles = (): string[] =>
  execFileSync(
    'git',
    ['ls-files', '-z', '--', ...SOURCE_ROOTS, 'docs', 'README.md', 'CLAUDE.md'],
    { cwd: REPO_ROOT, encoding: 'utf8' },
  )
    .split('\0')
    .filter(
      path =>
        path !== '' &&
        (/\.(c|m)?[jt]sx?$|\.(json|md|css|sh|ya?ml)$/.test(path) ||
          isLicence(path)),
    );
