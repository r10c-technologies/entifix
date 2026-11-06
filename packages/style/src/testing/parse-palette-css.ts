import type { PaletteValues } from './assert-palette-contract.js';

/** The selector a palette block is keyed on, or `@theme` for the defaults. */
const BLOCK = /(@theme|\[data-theme=(?:'([^']+)'|"([^"]+)")\])\s*\{([^{}]*)\}/g;
const DECLARATION = /--color-([a-z0-9-]+)\s*:\s*([^;]+);/gi;

/**
 * Reads the `--color-*` declarations of every palette block in a stylesheet:
 * `@theme { … }` as `default`, `[data-theme='x'] { … }` as `x`. Comments are
 * dropped first so a commented-out value is never read. A block that only
 * overrides some tokens is returned as written; merging over the defaults is
 * the caller's decision, because a runtime palette may not sit on them.
 */
export function parsePaletteCss(css: string): Record<string, PaletteValues> {
  const source = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const palettes: Record<string, Record<string, string>> = {};
  for (const block of source.matchAll(BLOCK)) {
    const id = block[2] ?? block[3] ?? 'default';
    const palette = (palettes[id] ??= {});
    for (const decl of block[4].matchAll(DECLARATION)) {
      palette[decl[1]] = decl[2].trim();
    }
  }
  return palettes;
}
