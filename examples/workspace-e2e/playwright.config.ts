import { defineEntifixE2eConfig } from '@entifix/testing-e2e/playwright';

/**
 * The hermetic e2e for `example-workspace`, and the only e2e entifix runs on
 * every pull request.
 *
 * Nothing is mocked because nothing leaves the page: the repositories are in
 * memory and the one server call, record search, is the app's own route.
 *
 * Port 3200 rather than a common one: the preset reuses a server already
 * listening, so a port another project's dev server holds would quietly run
 * these journeys against the wrong app.
 */
export default defineEntifixE2eConfig({
  configFile: __filename,
  appDir: 'examples/workspace',
  port: 3200,
  readyPath: '/api/health/live',
});
