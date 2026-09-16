import { defineEntifixTest } from '../../vitest.shared.mjs';

export default defineEntifixTest({
  name: '@entifix/dev-sync',
  root: __dirname,
  // The command-line entry reads the process environment and runs git; the
  // logic it calls is in `sync.ts`, which is held to the full threshold.
  coverageExclude: ['src/main.ts'],
});
