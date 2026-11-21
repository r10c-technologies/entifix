import { join } from 'node:path';

import { workspaceRoot } from '@nx/devkit';
import { nxE2EPreset } from '@nx/playwright/preset';
import { defineConfig, devices } from '@playwright/test';

const PORT = 3210;
const baseURL = process.env['BASE_URL'] ?? `http://localhost:${PORT}`;

/**
 * The docs engine's gate (entifix ADR 0031 §4.7): the exported example site,
 * served as a static host serves it, under its base path. It runs on every
 * pull request that touches the engine, fumadocs or the tokens — so a
 * fumadocs bump that breaks a condition fails here, not on a reader's screen.
 *
 * Written out rather than taken from `defineEntifixE2eConfig`, for the reason
 * `example-workspace-e2e`'s config gives: Nx loads this file before anything
 * is built.
 */
export default defineConfig({
  ...nxE2EPreset(__filename, { testDir: './src' }),
  use: { baseURL, trace: 'on-first-retry' },
  webServer: {
    command: `node serve.mjs`,
    cwd: join(workspaceRoot, 'examples/docs'),
    env: { PORT: String(PORT) },
    url: `${baseURL}/health`,
    reuseExistingServer: !process.env['CI'],
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
