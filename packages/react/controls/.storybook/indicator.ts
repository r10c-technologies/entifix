import { contrastRatio, parseColor, type Rgb } from '@entifix/style/testing';

const parse = (value: string): Rgb | undefined => {
  // Computed colours are `rgb(r, g, b)` or, with alpha, `rgba(…)`.
  const alpha = /^rgba\((.+),\s*([\d.]+)\)$/.exec(value);
  if (alpha) return Number(alpha[2]) === 0 ? undefined : parseColor(`rgb(${alpha[1]})`);
  return parseColor(value);
};

/** The opaque colour painted behind `element`: its own, or the nearest ancestor's. */
export function backgroundOf(element: Element): Rgb {
  for (let node: Element | null = element; node; node = node.parentElement) {
    const rgb = parse(getComputedStyle(node).backgroundColor);
    if (rgb) return rgb;
  }
  return [255, 255, 255];
}

/**
 * The contrast of `element`'s focus indicator against `against` (the panel
 * it sits in): its outline when one is drawn at 2px or more, otherwise 1 —
 * a background swap is not an indicator (WCAG 2.4.7, 1.4.11; ADR 0025).
 */
export function indicatorContrast(element: Element, against: Element): number {
  const style = getComputedStyle(element);
  if (style.outlineStyle === 'none' || parseFloat(style.outlineWidth) < 2) return 1;
  const ring = parse(style.outlineColor);
  return ring ? contrastRatio(ring, backgroundOf(against)) : 1;
}
