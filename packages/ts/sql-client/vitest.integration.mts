import { defineEntifixTest } from '../../../vitest.shared.mjs';

/**
 * The contract suites against a real Postgres at `ENTIFIX_PG_URL` — the outbox
 * claim rides `FOR UPDATE SKIP LOCKED` and an advisory lock, which no fake can
 * execute. Coverage is the unit suite's; this one proves behaviour.
 */
export default defineEntifixTest({
  name: '@entifix/sql:integration',
  root: import.meta.dirname,
  include: ['src/**/*.integration.spec.ts'],
  thresholds: false,
  hookTimeout: 30_000,
});
