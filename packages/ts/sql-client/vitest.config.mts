import { defineEntifixTest } from '../../../vitest.shared.mjs';

export default defineEntifixTest({
  name: '@entifix/sql',
  root: import.meta.dirname,
  // Real Postgres only, under `test-integration`.
  exclude: ['**/*.integration.spec.ts'],
});
