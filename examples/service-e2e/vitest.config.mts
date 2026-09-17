import { defineEntifixTest } from '../../vitest.shared.mjs';

/**
 * `mock` (the default) boots the service in this process over the drivers'
 * fakes; `live` points the same journeys at a running service with
 * `EXAMPLE_SERVICE_URL`. The variable is read directly here, because Vitest loads
 * this file before any workspace package can be resolved.
 */
const mock = (process.env['E2E_PROFILE'] ?? 'mock') === 'mock';

export default defineEntifixTest({
  name: '@entifix/example-service-e2e',
  root: import.meta.dirname,
  thresholds: false,
  hookTimeout: 60_000,
  exclude: mock ? ['**/*.live.spec.ts'] : ['**/*.mock.spec.ts'],
});
