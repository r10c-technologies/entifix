import { defineEntifixTest } from '../../vitest.shared.mjs';

export default defineEntifixTest({
  name: '@entifix/tiers',
  root: __dirname,
  // Declarations, not logic — assertions rather than code. What guards
  // this project is that its own assertions still run, which the pinned
  // package count enforces from the inside.
  thresholds: false,
});
