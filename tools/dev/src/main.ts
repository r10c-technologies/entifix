import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

import { parseConsumers, reset, sync, SyncError } from './sync.ts';

// node tools/dev/src/main.ts [@entifix/<name> …]
// node tools/dev/src/main.ts --reset
//
// Syncs the named packages into every repository in ENTIFIX_CONSUMERS, or every
// publishable package when none is named; `--reset` puts the consumers back on
// the release they install. Runs under Node's own type stripping: no build step
// between a save and the consumer seeing it.

const root = join(import.meta.dirname, '..', '..', '..');
const args = process.argv.slice(2);
const log = (line: string) => console.log(line);

try {
  const consumers = parseConsumers(process.env['ENTIFIX_CONSUMERS']);
  if (args.includes('--reset')) {
    reset(
      consumers,
      consumer =>
        execFileSync(
          'pnpm',
          ['install', '--config.optimistic-repeat-install=false'],
          { cwd: consumer, stdio: 'inherit' },
        ),
      log,
    );
  } else {
    const written = sync(root, args, {
      consumers,
      source: execFileSync('git', ['rev-parse', '--short', 'HEAD'], {
        cwd: root,
        encoding: 'utf8',
      }).trim(),
      now: new Date(),
      log,
    });
    if (written === 0) console.log('dev-sync: nothing written');
  }
} catch (error) {
  if (!(error instanceof SyncError)) throw error;
  console.error(`dev-sync: ${error.message}`);
  process.exitCode = 1;
}
