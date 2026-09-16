import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

import { parseConsumers, sync, SyncError } from './sync.ts';

// node tools/dev/src/main.ts [@entifix/<name> …]
//
// Syncs the named packages' `dist` into every repository in ENTIFIX_CONSUMERS,
// or every publishable package when none is named. Runs under Node's own type
// stripping: no build step between a save and the consumer seeing it.

const root = join(import.meta.dirname, '..', '..', '..');

try {
  const written = sync(root, process.argv.slice(2), {
    consumers: parseConsumers(process.env['ENTIFIX_CONSUMERS']),
    source: execFileSync('git', ['rev-parse', '--short', 'HEAD'], {
      cwd: root,
      encoding: 'utf8',
    }).trim(),
    now: new Date(),
    log: line => console.log(line),
  });
  if (written === 0) console.log('dev-sync: nothing written');
} catch (error) {
  if (!(error instanceof SyncError)) throw error;
  console.error(`dev-sync: ${error.message}`);
  process.exitCode = 1;
}
