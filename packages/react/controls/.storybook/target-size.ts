/**
 * WCAG 2.5.8 measured the way a pointer meets a control, not the way axe does:
 * axe's `target-size` reads each element's own box and ignores a pseudo-element
 * hit area, and it accepts a small target on the spacing exception. ADR 0025
 * relies on neither, so the gate samples every interactive element at fixed +
 * compact — the smallest a control is ever painted — and requires that a
 * `--target-min` circle centred on it (2.5.8's own measure) lands on the
 * control everywhere on its edge. A square would fail every rounded control
 * at its corners, where the pointer genuinely misses it but no user aims.
 */
const INTERACTIVE = [
  'a[href]',
  'button',
  'input:not([type="hidden"])',
  'select',
  'textarea',
  'summary',
  '[role="button"]',
  '[role="link"]',
  '[role="tab"]',
  '[role="menuitem"]',
  '[role="option"]',
  '[role="switch"]',
  '[role="checkbox"]',
].join(',');

/** A link inside a run of text is exempt (2.5.8's inline exception). */
const isInlineLink = (element: Element) =>
  element instanceof HTMLAnchorElement &&
  getComputedStyle(element).display === 'inline';

const isDisabled = (element: Element) =>
  element.matches(':disabled') || element.getAttribute('aria-disabled') === 'true';

/** A visually hidden input (a switch's checkbox) is hit through its label. */
const targetOf = (element: Element): Element => {
  const box = element.getBoundingClientRect();
  if (
    (box.width <= 1 || box.height <= 1) &&
    element instanceof HTMLInputElement &&
    element.labels?.[0]
  ) {
    return element.labels[0];
  }
  return element;
};

const reaches = (hit: Element | null, control: Element, target: Element) =>
  hit !== null &&
  (target.contains(hit) ||
    (control instanceof HTMLInputElement &&
      [...(control.labels ?? [])].some(label => label.contains(hit))));

interface Clip {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
}

/**
 * The visible rectangle `element` is painted in: the viewport, cut by every
 * ancestor that clips its overflow. A point outside it is scrolled out of
 * view, which is not where a pointer meets the control.
 */
const clipOf = (element: Element, view: Window): Clip => {
  let clip: Clip = { left: 0, top: 0, right: view.innerWidth, bottom: view.innerHeight };
  for (let node = element.parentElement; node; node = node.parentElement) {
    const { overflowX, overflowY } = getComputedStyle(node);
    if (overflowX === 'visible' && overflowY === 'visible') continue;
    const box = node.getBoundingClientRect();
    clip = {
      left: Math.max(clip.left, box.left),
      top: Math.max(clip.top, box.top),
      right: Math.min(clip.right, box.right),
      bottom: Math.min(clip.bottom, box.bottom),
    };
  }
  return clip;
};

const inside = (clip: Clip, x: number, y: number) =>
  x >= clip.left && x < clip.right && y >= clip.top && y < clip.bottom;

/** Each interactive element under `root` whose hit area is under `min` px. */
export function undersizedTargets(root: ParentNode, min: number): string[] {
  const view = (root as Node).ownerDocument?.defaultView ?? window;
  const findings: string[] = [];
  for (const control of root.querySelectorAll(INTERACTIVE)) {
    if (isInlineLink(control) || isDisabled(control)) continue;
    // Behind a modal: covered by its scrim, and not a target until it closes.
    if (control.closest('[inert]')) continue;
    const target = targetOf(control);
    const box = target.getBoundingClientRect();
    // Visually hidden (a focus sentinel), and not a pointer target at all.
    if (box.width <= 1 || box.height <= 1) continue;
    if (!target.checkVisibility({ visibilityProperty: true })) continue;
    const cx = box.left + box.width / 2;
    const cy = box.top + box.height / 2;
    // Hit testing rounds to whole pixels, so a control exactly at the floor
    // would miss its own edge at a fractional offset: sample 1px inside it.
    const r = min / 2 - 1;
    const d = r * Math.SQRT1_2;
    const points = [
      [cx, cy],
      [cx, cy - r],
      [cx, cy + r],
      [cx - r, cy],
      [cx + r, cy],
      [cx - d, cy - d],
      [cx + d, cy - d],
      [cx - d, cy + d],
      [cx + d, cy + d],
    ].filter(([x, y]) => inside(clipOf(target, view), x!, y!));
    // A control whose centre is covered (behind a modal's scrim) is not a
    // target in this state; that is not a size the pointer can miss.
    if (!reaches(view.document.elementFromPoint(cx, cy), control, target)) {
      continue;
    }
    const missed = points.filter(
      ([x, y]) => !reaches(view.document.elementFromPoint(x!, y!), control, target),
    );
    if (missed.length > 0) {
      const name =
        control.getAttribute('aria-label') ??
        control.textContent?.trim().slice(0, 30) ??
        '';
      const [x, y] = missed[0]!;
      const hit = view.document.elementFromPoint(x!, y!);
      findings.push(
        `<${control.tagName.toLowerCase()}> "${name}" ${Math.round(box.width)}×${Math.round(box.height)}, missed at (${Math.round(x! - box.left)}, ${Math.round(y! - box.top)}) on <${hit?.tagName.toLowerCase() ?? 'nothing'} class="${hit?.getAttribute('class')?.slice(0, 60) ?? ''}">`,
      );
    }
  }
  return findings;
}

/** The current `--target-min`, in px, as the document resolves it. */
export function targetMin(element: Element): number {
  return parseFloat(getComputedStyle(element).getPropertyValue('--target-min')) || 24;
}
