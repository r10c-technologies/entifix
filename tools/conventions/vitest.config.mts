import { defineEntifixTest } from '../../vitest.shared.mjs';

export default defineEntifixTest({
  name: '@entifix/conventions',
  root: import.meta.dirname,
  // Assertions about the lint configuration, not code under test. What guards
  // this project is that its own checks still run.
  thresholds: false,
});
