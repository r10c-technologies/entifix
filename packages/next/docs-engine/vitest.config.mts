import { defineEntifixTest } from '../../../vitest.shared.mjs';

export default defineEntifixTest({
  name: '@entifix/docs-engine',
  root: import.meta.dirname,
  environment: 'jsdom',
  setupFiles: ['./vitest.setup.ts'],
});
