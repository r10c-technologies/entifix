import {
  decodeProblem,
  type EntifixFailure,
  FAILURE_CATEGORIES,
  familyOf,
  lookupFailure,
  problemOf,
} from '@entifix/core';
import { describe, expect, it } from 'vitest';

/**
 * What every failure must be, wherever it is defined
 * ([ADR 0013](../../../../../docs/adr/0013-failures-are-typed-values-decided-at-the-shell.md)):
 * registered under its code, categorised, and able to cross a wire and come
 * back as itself — without carrying a stack or a stringified error with it.
 *
 * Run it once per failure a package defines, with a sample built the way the
 * package builds it. A failure that cannot round-trip decodes in a client as a
 * `ProtocolFailure`, which is a refusal the user is never told the reason for.
 */
export const describeFailureContract = (
  name: string,
  sample: EntifixFailure,
): void => {
  describe(`failure contract: ${name}`, () => {
    it('is registered under its code, by its own tag', () => {
      expect(lookupFailure(sample.code)?.tag).toBe(sample._tag);
    });

    it('belongs to one of the closed categories, and its family follows', () => {
      expect(FAILURE_CATEGORIES).toContain(sample.category);
      expect(sample.family).toBe(familyOf(sample.category));
    });

    it('decodes from its problem body back to itself, fields and all', () => {
      const body = problemOf(sample);
      const decoded = decodeProblem(JSON.parse(JSON.stringify(body)));

      expect(decoded._tag).toBe(sample._tag);
      expect(problemOf(decoded)).toEqual(body);
    });

    it('carries no stack and no stringified error onto the wire', () => {
      const body = problemOf(sample);
      const text = JSON.stringify(body);

      expect(body).not.toHaveProperty('stack');
      expect(text).not.toContain('[object');
      expect(text).not.toMatch(/\n\s+at /);
    });
  });
};
