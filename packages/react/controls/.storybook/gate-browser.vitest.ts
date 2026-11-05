import { commands, page } from 'vitest/browser';

import type { GateEnvironment } from './gate-browser.js';

export type { GateEnvironment } from './gate-browser.js';

declare module 'vitest/browser' {
  interface BrowserCommands {
    emulateForcedColors: (active: boolean) => Promise<void>;
  }
}

/** Vitest browser mode's default, restored after a story that changed it. */
const DEFAULT_VIEWPORT = { width: 414, height: 896 } as const;

/**
 * What the browser was last put into by this file, so an unchanged story costs
 * nothing. Unknown at first: the page outlives a test file, so the previous
 * file may have left it at any viewport or under forced colours.
 */
let current: Required<GateEnvironment> | undefined;

/**
 * Puts the gate's browser into the environment a story declares — and every
 * story declares one, the default when it says nothing. Entering is what
 * resets: a cleanup handed back to Storybook is not reliably run between
 * stories in one file, and a story at 320px or under forced colours that leaked
 * into the next one turned 48 unrelated stories red.
 */
export async function enterGateEnvironment({
  viewport = DEFAULT_VIEWPORT,
  forcedColors = false,
}: GateEnvironment): Promise<() => Promise<void>> {
  if (
    viewport.width !== current?.viewport.width ||
    viewport.height !== current.viewport.height
  ) {
    await page.viewport(viewport.width, viewport.height);
  }
  if (forcedColors !== current?.forcedColors) {
    await commands.emulateForcedColors(forcedColors);
  }
  current = { viewport, forcedColors };
  return async () => undefined;
}
