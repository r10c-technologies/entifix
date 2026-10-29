import { existsSync, readdirSync } from 'node:fs';
import { dirname } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  type JournalCase,
  journalPath,
  readJournal,
  recordCommands,
  writeJournal,
} from '../../test/journals/journal.js';
import { interpretedSlipVersions } from './slip-workflow.js';

/*
 * The journal gate (ADR 0016): every grammar version the interpreter walks
 * replays its recorded runs to the same command sequence. Re-record after a
 * deliberate change with `pnpm nx run @entifix/workflow:record-journals` —
 * which is right only for a new `slipVersion`, never for one flows may be
 * journaled under.
 */
const recording = process.env['ENTIFIX_RECORD_JOURNALS'] === '1';

describe.each(interpretedSlipVersions)('slipVersion %i', slipVersion => {
  const present = existsSync(journalPath(slipVersion));
  const cases: readonly JournalCase[] = present
    ? readJournal(slipVersion).cases
    : [];

  it('has a journal', () => {
    expect(present, `test/journals/slip-v${String(slipVersion)}.json`).toBe(
      true,
    );
    expect(cases.length).toBeGreaterThan(0);
  });

  if (recording)
    it('records its journal', async () => {
      const recorded: JournalCase[] = [];
      for (const journalCase of cases)
        recorded.push({
          ...journalCase,
          commands: await recordCommands(journalCase),
        });
      writeJournal({ slipVersion, cases: recorded });
    });
  else
    it.each(cases.map(journalCase => [journalCase.name, journalCase] as const))(
      'replays “%s” to its recorded commands',
      async (_name, journalCase) => {
        expect(journalCase.commands.length).toBeGreaterThan(0);
        expect(await recordCommands(journalCase)).toEqual(journalCase.commands);
      },
    );
});

it('keeps no journal for a version the interpreter does not walk', () => {
  const journaled = readdirSync(dirname(journalPath(1)))
    .map(file => /^slip-v(\d+)\.json$/.exec(file)?.[1])
    .filter(version => version !== undefined)
    .map(Number);

  expect(journaled.sort()).toEqual([...interpretedSlipVersions].sort());
});
