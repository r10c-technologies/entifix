import { defineEntifixTest } from '../../../vitest.shared.mjs';

export default defineEntifixTest({
  name: '@entifix/react-integration',
  root: import.meta.dirname,
  environment: 'jsdom',
  // Fixtures for this package's own specs, not shipped code.
  coverageExclude: ['**/spec-support/**'],
});
