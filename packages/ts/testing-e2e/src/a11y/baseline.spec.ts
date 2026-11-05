import { describe, expect, it } from 'vitest';

import {
  type A11yViolation,
  compareWithBaseline,
  describeVerdict,
  findingsOf,
  FINGERPRINT_KEY,
  FINGERPRINT_SCHEME,
  fingerprintOf,
  normalizeTarget,
  screenOf,
  unownedEntries,
  updateBaseline,
} from './baseline.js';

const contrast = (...targets: string[]): A11yViolation => ({
  id: 'color-contrast',
  impact: 'serious',
  help: 'Elements must meet minimum color contrast ratio thresholds',
  nodes: targets.map(target => ({ target: [target] })),
});

describe('normalizeTarget', () => {
  it('writes the ids React, Headless UI and Radix mint per render as #generated-id', () => {
    expect(normalizeTarget(['#\\:r1\\: > span'])).toBe('#generated-id > span');
    expect(normalizeTarget(['#headlessui-menu-button-3'])).toBe(
      '#generated-id',
    );
    expect(normalizeTarget(['div > #«r4» > button'])).toBe(
      'div > #generated-id > button',
    );
    expect(normalizeTarget(['#radix-:r2:-content'])).toBe('#generated-id');
  });

  it('orders classes and attributes, whatever order axe chose', () => {
    expect(
      normalizeTarget(['li > .shrink-0.rounded[title="Open"][href$="a"]']),
    ).toBe(
      normalizeTarget(['li > .rounded.shrink-0[href$="a"][title="Open"]']),
    );
    expect(normalizeTarget(['a.link:hover#main'])).toBe('a#main.link:hover');
    expect(normalizeTarget(['ul + li ~ p'])).toBe('ul + li ~ p');
    expect(normalizeTarget(['nav   .b.a'])).toBe('nav .a.b');
    expect(normalizeTarget(['a:focus:hover.x'])).toBe('a.x:focus:hover');
  });

  it('keeps quoted values, escaped classes and brackets whole', () => {
    expect(
      normalizeTarget([
        'li > a[title="Abrir en una pestaña nueva"][rel="noopener noreferrer"]',
      ]),
    ).toBe(
      'li > a[rel="noopener noreferrer"][title="Abrir en una pestaña nueva"]',
    );
    expect(normalizeTarget(['.hover\\:bg-surface\\/60.group'])).toBe(
      '.group.hover\\:bg-surface\\/60',
    );
    expect(normalizeTarget(["p:not(.a .b)[data-x='y z']"])).toBe(
      "p[data-x='y z']:not(.a .b)",
    );
    expect(normalizeTarget(['a::before.x'])).toBe('a.x::before');
    // A dangling escape is kept as it came, not read past the end.
    expect(normalizeTarget(['.b.a\\'])).toBe('.a\\.b');
  });

  it('collapses a run of identical siblings into one selector', () => {
    expect(normalizeTarget(['li:nth-child(3) > a'])).toBe(
      normalizeTarget(['li:nth-child(7) > a']),
    );
    expect(normalizeTarget(['p:nth-of-type(2)'])).toBe('p:nth-of-type(n)');
  });

  it('joins frame and shadow paths, and keeps a stable id', () => {
    expect(normalizeTarget([['#host', 'button'], '#save'])).toBe(
      '#host >>> button >>> #save',
    );
  });
});

describe('a fingerprint', () => {
  it('names the rule, the node and the screen, and gives the screen back', () => {
    const fingerprint = fingerprintOf('label', 'input', 'customers');
    expect(fingerprint).toBe('label|input|customers');
    expect(screenOf(fingerprint)).toBe('customers');
  });
});

describe('findingsOf', () => {
  it('reduces violations to sorted, distinct findings', () => {
    expect(
      findingsOf('home', [
        contrast('li:nth-child(2) > a', 'li:nth-child(1) > a', '.badge'),
        { id: 'region', nodes: [{ target: ['aside'] }] },
      ]),
    ).toEqual([
      {
        fingerprint: 'color-contrast|.badge|home',
        impact: 'serious',
        help: 'Elements must meet minimum color contrast ratio thresholds',
      },
      {
        fingerprint: 'color-contrast|li:nth-child(n) > a|home',
        impact: 'serious',
        help: 'Elements must meet minimum color contrast ratio thresholds',
      },
      { fingerprint: 'region|aside|home', impact: 'minor', help: 'region' },
    ]);
  });
});

describe('a node with an ancestry', () => {
  it('is fingerprinted by it, not by the target axe shortened', () => {
    expect(
      findingsOf('home', [
        {
          id: 'region',
          impact: 'moderate',
          nodes: [
            {
              target: ['.gallery'],
              ancestry: ['html > body > main:nth-child(2) > div:nth-child(4)'],
            },
          ],
        },
      ]).map(finding => finding.fingerprint),
    ).toEqual([
      'region|html > body > main:nth-child(n) > div:nth-child(n)|home',
    ]);
  });
});

describe('compareWithBaseline', () => {
  const findings = findingsOf('home', [
    contrast('.badge', '.price'),
    {
      id: 'landmark-unique',
      impact: 'moderate',
      help: 'Landmarks should be unique',
      nodes: [{ target: ['nav'] }],
    },
  ]);

  it('fails a new serious finding, and only reports a moderate one', () => {
    const verdict = compareWithBaseline('home', findings, {
      'color-contrast|.badge|home': 'acme/shop#1',
    });
    expect(verdict.added.map(finding => finding.fingerprint)).toEqual([
      'color-contrast|.price|home',
    ]);
    expect(verdict.reported.map(finding => finding.fingerprint)).toEqual([
      'landmark-unique|nav|home',
    ]);
    expect(verdict.stale).toEqual([]);
  });

  it('fails an accepted finding that is gone, on this screen only', () => {
    const verdict = compareWithBaseline('home', findings, {
      'color-contrast|.badge|home': 'acme/shop#1',
      'color-contrast|.price|home': 'acme/shop#1',
      'label|input|home': 'acme/shop#2',
      'label|input|cart': 'acme/shop#2',
      [FINGERPRINT_KEY]: FINGERPRINT_SCHEME,
    });
    expect(verdict.added).toEqual([]);
    expect(verdict.stale).toEqual(['label|input|home']);
  });

  it('explains each failure', () => {
    const verdict = compareWithBaseline('home', findings, {
      'label|input|home': 'acme/shop#2',
    });
    expect(describeVerdict('home', verdict).split('\n')).toEqual([
      'home: new serious violation color-contrast|.badge|home — Elements must meet minimum color contrast ratio thresholds',
      'home: new serious violation color-contrast|.price|home — Elements must meet minimum color contrast ratio thresholds',
      'home: label|input|home is in the baseline but no longer found — delete its entry',
    ]);
  });
});

describe('updateBaseline', () => {
  it("rewrites this screen's entries, keeps owners and other screens", () => {
    const next = updateBaseline(
      'home',
      findingsOf('home', [
        contrast('.badge', '.price'),
        { id: 'region', impact: 'minor', nodes: [{ target: ['aside'] }] },
      ]),
      {
        'color-contrast|.badge|home': 'acme/shop#1',
        'label|input|home': 'acme/shop#2',
        'label|input|cart': 'acme/shop#2',
      },
    );
    expect(next).toEqual({
      [FINGERPRINT_KEY]: FINGERPRINT_SCHEME,
      'color-contrast|.badge|home': 'acme/shop#1',
      'color-contrast|.price|home': '',
      'label|input|cart': 'acme/shop#2',
    });
    const keys = Object.keys(next).slice(1);
    expect(keys).toEqual([...keys].sort());
  });
});

describe('unownedEntries', () => {
  it('names every entry without an owner/repo#N issue', () => {
    expect(
      unownedEntries({
        [FINGERPRINT_KEY]: FINGERPRINT_SCHEME,
        'a|b|home': 'acme/shop#1',
        'a|c|home': '',
        'a|d|home': '#12',
        'a|e|home': 'shop#3',
      }),
    ).toEqual(['a|c|home', 'a|d|home', 'a|e|home']);
  });
});
