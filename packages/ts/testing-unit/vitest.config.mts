import { defineEntifixTest } from '../../../vitest.shared.mjs';

export default defineEntifixTest({
  name: '@entifix/testing-unit',
  root: import.meta.dirname,
  environment: 'jsdom',
});
