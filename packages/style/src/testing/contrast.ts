/**
 * WCAG 2.x relative luminance and contrast ratio, over the colour forms a
 * palette is written in: `#rgb`, `#rrggbb`, and `rgb()` with comma or space
 * separated channels. A colour with alpha has no contrast of its own (it
 * depends on what is under it), so it is refused rather than guessed.
 */
export type Rgb = readonly [number, number, number];

const HEX = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;
const RGB = /^rgba?\(\s*(\d{1,3})[\s,]+(\d{1,3})[\s,]+(\d{1,3})\s*\)$/i;

export function parseColor(value: string): Rgb | undefined {
  const v = value.trim();
  const hex = HEX.exec(v);
  if (hex) {
    const h =
      hex[1].length === 3 ? [...hex[1]].map(c => c + c).join('') : hex[1];
    return [0, 2, 4].map(i =>
      Number.parseInt(h.slice(i, i + 2), 16),
    ) as unknown as Rgb;
  }
  const rgb = RGB.exec(v);
  if (rgb) {
    const channels = [rgb[1], rgb[2], rgb[3]].map(Number);
    if (channels.every(c => c <= 255)) return channels as unknown as Rgb;
  }
  return undefined;
}

function channel(c: number): number {
  const s = c / 255;
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

export function relativeLuminance([r, g, b]: Rgb): number {
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

export function contrastRatio(a: Rgb, b: Rgb): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}
