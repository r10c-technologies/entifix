import { defineEntifixTest } from '../../../vitest.shared.mjs';

export default defineEntifixTest({
  name: '@entifix/next-shell',
  root: import.meta.dirname,
  environment: 'jsdom',
  setupFiles: ['./vitest.setup.i18n.ts'],
});
