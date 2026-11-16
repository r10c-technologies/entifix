/**
 * The browser a story asks to be rendered in, through `parameters.gate`:
 * a viewport, or forced colours. The Vitest gate (`test-a11y`) resolves this
 * module to `gate-browser.vitest.ts`, which drives the real browser; in
 * `storybook dev` and `build-storybook` there is no browser to drive, so it is
 * this no-op and the story renders in whatever window it was opened in.
 */
export interface GateEnvironment {
  readonly viewport?: { readonly width: number; readonly height: number };
  readonly forcedColors?: boolean;
}

export async function enterGateEnvironment(
  _environment: GateEnvironment,
): Promise<() => Promise<void>> {
  return async () => undefined;
}

/**
 * The links and buttons the browser's accessibility tree leaves without a
 * name. Only the Vitest gate can read that tree; here there is none to read.
 */
export async function unnamedControls(): Promise<readonly string[]> {
  return [];
}
