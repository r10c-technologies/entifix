import { defineEntifixTest } from '../../../vitest.shared.mjs';

export default defineEntifixTest({
  name: '@entifix/workflow',
  root: import.meta.dirname,
  // Real Postgres only, under `test-integration`.
  exclude: ['**/*.integration.spec.ts'],
});
