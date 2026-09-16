import { join } from 'node:path';

import { workspaceRoot } from '@nx/devkit';
import { nxE2EPreset } from '@nx/playwright/preset';
import { defineConfig, devices } from '@playwright/test';

const PORT = 3200;
const baseURL = process.env['BASE_URL'] ?? `http://localhost:${PORT}`;

/**
 * The hermetic e2e for `example-workspace`, and the only e2e entifix runs on
 * every pull request.
 *
 * ⚠️ **Written out rather than taken from `defineEntifixE2eConfig`.** Nx builds
 * its project graph by loading this file in plain Node, before anything is
 * built, so an import of `@entifix/testing-e2e/playwright` resolves to a `dist`
 * that a clean checkout does not have — `Cannot find module …/dist/…` — and the
 * graph fails for every command in the workspace, including the ones that would
 * have built it. The specs are loaded later, by the `e2e` target, with the
 * `@entifix/source` condition set (`nx.json`), so they import the package
 * freely.
 *
 * What the preset would have added and this suite does not need: the profile
 * switch (there is no live profile — nothing leaves the page) and a server
 * command override.
 *
 * Port 3200 rather than a common one: `reuseExistingServer` would otherwise
 * quietly run these journeys against whatever else is listening.
 */
export default defineConfig({
  ...nxE2EPreset(__filename, { testDir: './src' }),
  use: { baseURL, trace: 'on-first-retry' },
  webServer: {
    command: `pnpm exec next start -p ${PORT}`,
    cwd: join(workspaceRoot, 'examples/workspace'),
    url: `${baseURL}/api/health/live`,
    reuseExistingServer: true,
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
