import { defineEntifixTest } from '../../../vitest.shared.mjs';

/**
 * The chaos suite: two runner processes over a real Postgres at
 * `ENTIFIX_PG_URL`, killed and restarted. It runs the built packages, so the
 * target builds first. Coverage is the unit suite's; this one proves
 * behaviour the engine has got wrong before.
 */
export default defineEntifixTest({
  name: '@entifix/workflow:engine',
  root: import.meta.dirname,
  include: ['test/engine/**/*.engine.spec.ts'],
  thresholds: false,
  hookTimeout: 60_000,
});
