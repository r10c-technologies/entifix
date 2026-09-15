import { defineEntifixTest } from '../../vitest.shared.mjs';

export default defineEntifixTest({
  name: '@entifix/docs-check',
  root: __dirname,
  // Assertions about prose, not code. What guards this project is that its own
  // checks still run.
  thresholds: false,
});
