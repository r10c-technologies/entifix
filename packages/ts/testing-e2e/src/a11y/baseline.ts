/**
 * The screen-level accessibility ratchet, as data: what axe found on one
 * screen, reduced to fingerprints that survive a re-render, compared with what
 * a committed baseline already accepts.
 *
 * A baseline maps each accepted fingerprint to the issue that removes it, so a
 * host can switch the gate on with a backlog and the backlog can only shrink:
 * a new serious or critical fingerprint fails, and so does an accepted one
 * that is no longer there, which is how a fix is made to delete its entry.
 */

/** axe's impact levels, least to most severe. */
export type A11yImpact = 'minor' | 'moderate' | 'serious' | 'critical';

/** The part of an axe node this module reads. */
export interface A11yNodeResult {
  readonly target: readonly unknown[];
}

/** The part of an axe violation this module reads. */
export interface A11yViolation {
  readonly id: string;
  readonly impact?: A11yImpact | null;
  readonly help?: string;
  readonly nodes: readonly A11yNodeResult[];
}

/** One fingerprint found on a screen, with the severity it was found at. */
export interface A11yFinding {
  readonly fingerprint: string;
  readonly impact: A11yImpact;
  readonly help: string;
}

/** Accepted fingerprints, each against the issue that removes it. */
export type A11yBaseline = Readonly<Record<string, string>>;

/** What a gate run decides for one screen. */
export interface A11yVerdict {
  /** Serious or critical, and not in the baseline: these fail. */
  readonly added: readonly A11yFinding[];
  /** In the baseline for this screen, and no longer found: these fail too. */
  readonly stale: readonly string[];
  /** Moderate or minor: reported, never failing. */
  readonly reported: readonly A11yFinding[];
}

/** The levels that fail the gate (ADR 0024). */
export const GATED: ReadonlySet<A11yImpact> = new Set(['serious', 'critical']);

/** The rule tags the gate runs: WCAG 2.2 AA, with 2.1's A level. */
export const WCAG_22_AA_TAGS = [
  'wcag2a',
  'wcag2aa',
  'wcag21a',
  'wcag21aa',
  'wcag22aa',
] as const;

/**
 * Ids a framework mints per render: React's `useId` (`:r1:`, `«r1»`, and their
 * CSS-escaped forms), Headless UI's `headlessui-<part>-<n>` and Radix's
 * `radix-…`. Each is written `#generated-id`: the node is still there, its name is not.
 */
const GENERATED_ID =
  /#(?:headlessui-[\w-]+|(?:\\:|:|«)r[\w]+(?:\\:|:|»)[\w-]*|radix-[\w:-]+)/g;

/**
 * Splits `text` wherever `isBoundary` says a new token starts, ignoring
 * anything inside brackets, parentheses or quotes and any escaped character —
 * `[title="Open in a new tab"]` and Tailwind's `.bg-surface\/60` are one
 * token each.
 */
const tokenize = (
  text: string,
  isBoundary: (char: string, previous: string) => boolean,
): string[] => {
  const tokens: string[] = [];
  let current = '';
  let depth = 0;
  let quote = '';
  for (let at = 0; at < text.length; at += 1) {
    const char = text[at] as string;
    if (char === '\\') {
      current += char + (text[at + 1] ?? '');
      at += 1;
      continue;
    }
    if (
      quote === '' &&
      depth === 0 &&
      current !== '' &&
      isBoundary(char, current.at(-1) as string)
    ) {
      tokens.push(current);
      current = '';
    }
    if (quote !== '') {
      if (char === quote) quote = '';
    } else if (char === '"' || char === "'") {
      quote = char;
    } else if (char === '[' || char === '(') {
      depth += 1;
    } else if (char === ']' || char === ')') {
      depth -= 1;
    }
    current += char;
  }
  tokens.push(current);
  return tokens;
};

const RANK: Readonly<Record<string, number>> = {
  '#': 1,
  '.': 2,
  '[': 3,
  ':': 4,
};

/**
 * One compound selector with its ids, classes and attributes in a fixed
 * order. Pseudo-classes keep theirs: `:hover:not(…)` reads differently from
 * `:not(…):hover` even where the engine treats them alike.
 */
const canonicalCompound = (compound: string): string =>
  tokenize(compound, (char, previous) => char in RANK && previous !== ':')
    .map(part => ({ part, rank: RANK[part[0] as string] ?? 0 }))
    .sort(
      (a, b) =>
        a.rank - b.rank || (a.rank === 4 ? 0 : a.part.localeCompare(b.part)),
    )
    .map(({ part }) => part)
    .join('');

/** A complex selector, one canonical compound at a time. */
const canonicalSelector = (selector: string): string =>
  tokenize(selector.trim(), char => /[\s>+~]/.test(char))
    .map(token => token.trim())
    .filter(token => token !== '')
    .map(token => (/^[>+~]$/.test(token) ? token : canonicalCompound(token)))
    .join(' ');

/**
 * A selector stable across renders and across axe's own choices: generated ids
 * written `#generated-id`; every `:nth-child(k)` and `:nth-of-type(k)` written
 * with `n`, so a run of identical siblings is one fingerprint rather than one
 * per row; and each compound's classes and attributes sorted, because axe
 * orders them by how unique they happen to be on the page at the time.
 */
export const normalizeTarget = (target: readonly unknown[]): string =>
  target
    .flatMap(part => (Array.isArray(part) ? part : [part]))
    .map(part =>
      canonicalSelector(
        String(part)
          .replace(GENERATED_ID, '#generated-id')
          .replace(/:nth-child\(\d+\)/g, ':nth-child(n)')
          .replace(/:nth-of-type\(\d+\)/g, ':nth-of-type(n)'),
      ),
    )
    .join(' >>> ');

/** `rule|target|screen`: the identity of one failing node. */
export const fingerprintOf = (rule: string, target: string, screen: string) =>
  `${rule}|${target}|${screen}`;

/** The screen a fingerprint belongs to. */
export const screenOf = (fingerprint: string) =>
  fingerprint.slice(fingerprint.lastIndexOf('|') + 1);

/** Every distinct fingerprint in `violations`, at its rule's impact. */
export const findingsOf = (
  screen: string,
  violations: readonly A11yViolation[],
): A11yFinding[] => {
  const found = new Map<string, A11yFinding>();
  for (const violation of violations) {
    for (const node of violation.nodes) {
      const fingerprint = fingerprintOf(
        violation.id,
        normalizeTarget(node.target),
        screen,
      );
      found.set(fingerprint, {
        fingerprint,
        impact: violation.impact ?? 'minor',
        help: violation.help ?? violation.id,
      });
    }
  }
  return [...found.values()].sort((a, b) =>
    a.fingerprint.localeCompare(b.fingerprint),
  );
};

/** Judges one screen's findings against the baseline. */
export const compareWithBaseline = (
  screen: string,
  findings: readonly A11yFinding[],
  baseline: A11yBaseline,
): A11yVerdict => {
  const gated = findings.filter(finding => GATED.has(finding.impact));
  const present = new Set(gated.map(finding => finding.fingerprint));
  return {
    added: gated.filter(finding => !(finding.fingerprint in baseline)),
    stale: Object.keys(baseline)
      .filter(fingerprint => screenOf(fingerprint) === screen)
      .filter(fingerprint => !present.has(fingerprint))
      .sort(),
    reported: findings.filter(finding => !GATED.has(finding.impact)),
  };
};

/**
 * The baseline with this screen's entries replaced by what was found: owners
 * kept for fingerprints still present, and an empty owner for a new one, which
 * {@link unownedEntries} refuses until a person names its issue.
 */
export const updateBaseline = (
  screen: string,
  findings: readonly A11yFinding[],
  baseline: A11yBaseline,
): A11yBaseline => {
  const next: Record<string, string> = {};
  for (const [fingerprint, owner] of Object.entries(baseline)) {
    if (screenOf(fingerprint) !== screen) next[fingerprint] = owner;
  }
  for (const finding of findings) {
    if (GATED.has(finding.impact)) {
      next[finding.fingerprint] = baseline[finding.fingerprint] ?? '';
    }
  }
  return Object.fromEntries(
    Object.entries(next).sort(([a], [b]) => a.localeCompare(b)),
  );
};

/** An issue reference in the form GitHub links across repositories. */
export const ISSUE_REFERENCE = /^[\w.-]+\/[\w.-]+#\d+$/;

/** Every entry whose owner is not an `owner/repo#N` issue reference. */
export const unownedEntries = (baseline: A11yBaseline): string[] =>
  Object.entries(baseline)
    .filter(([, owner]) => !ISSUE_REFERENCE.test(owner))
    .map(([fingerprint]) => fingerprint);

/** A failure message that names every fingerprint and what to do about it. */
export const describeVerdict = (screen: string, verdict: A11yVerdict) =>
  [
    ...verdict.added.map(
      finding =>
        `${screen}: new ${finding.impact} violation ${finding.fingerprint} — ${finding.help}`,
    ),
    ...verdict.stale.map(
      fingerprint =>
        `${screen}: ${fingerprint} is in the baseline but no longer found — delete its entry`,
    ),
  ].join('\n');
