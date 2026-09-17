import { join } from 'node:path';

import { workspaceRoot } from '@nx/devkit';
import { defineConfig, devices } from '@playwright/test';

const APP_PORT = 3201;
const SERVICE_PORT = 3301;

/**
 * The full stack, live: Postgres from `examples/compose.yaml`, the service, and
 * the Next app in front of it.
 *
 * An `e2e-live` target rather than `e2e`, and a file name the Playwright plugin does not infer one from, so the pull request check — which runs
 * every `e2e` target and has no database — never collects it. The nightly
 * workflow runs it after `docker compose up`.
 *
 * Written on `@playwright/test` directly: Nx loads this file in plain Node to
 * build its project graph, before any workspace package is built, so it may not
 * import one (ADR 0004).
 */
export default defineConfig({
  testDir: './src',
  fullyParallel: false,
  workers: 1,
  outputDir: './test-output/playwright',
  use: { baseURL: `http://localhost:${APP_PORT}`, trace: 'on-first-retry' },
  webServer: [
    {
      command: 'node src/main.ts',
      cwd: join(workspaceRoot, 'examples/minimal-service'),
      url: `http://localhost:${SERVICE_PORT}/api/health/ready`,
      reuseExistingServer: true,
      // The service must resolve published `dist`, never the workspace's
      // TypeScript source, which Node cannot strip decorators from.
      env: { NODE_OPTIONS: '' },
    },
    {
      command: `pnpm exec next start -p ${APP_PORT}`,
      cwd: join(workspaceRoot, 'examples/minimal'),
      url: `http://localhost:${APP_PORT}/api/health/live`,
      reuseExistingServer: true,
    },
  ],
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
