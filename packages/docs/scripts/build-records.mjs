// Generates what the package ships from `docs/adr`: `records/` and
// `records.json`. Runs after `compile`, so the reader it uses is the one that
// ships. Fails, and writes nothing, when a record is malformed.
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildRecords, ENTIFIX_AREAS } from '../dist/reader/index.js';

const here = dirname(fileURLToPath(import.meta.url));

const { records, problems } = buildRecords(
  join(here, '..', '..', '..', 'docs', 'adr'),
  join(here, '..'),
  { areas: ENTIFIX_AREAS },
);
if (problems.length > 0) {
  console.error(problems.join('\n'));
  process.exit(1);
}
console.log(`@entifix/docs: ${records.length} records`);
