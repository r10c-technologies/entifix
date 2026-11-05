import { defineEntifixTest } from '../../../vitest.shared.mjs';

export default defineEntifixTest({
  name: '@entifix/testing-e2e',
  root: import.meta.dirname,
  coverageExclude: [
    // The Playwright entry point: a config preset, a `test.extend` fixture and
    // a page object. Every line of it only executes inside a Playwright worker
    // driving a browser, so it cannot be reached from the vitest gate — and
    // faking a `Page` to reach it would assert nothing about the browser
    // behaviour it exists for. It is exercised by the app e2e suites instead,
    // in BOTH profiles.
    'src/playwright/**',
    // The accessibility gate's browser half, for the same reason: it drives
    // axe and the keyboard through a live `Page`. What it decides is in
    // `baseline.ts` and `walk.ts`, which are pure and fully covered here; the
    // example workspace's journeys run this half on every screen.
    'src/a11y/axe.ts',
    'src/a11y/keyboard.ts',
  ],
});
