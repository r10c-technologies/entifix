/**
 * The conventions entifix checks rather than states (ADR 0013): each is a lint
 * rule with a planted violation in `conventions.spec.ts`, so the rule failing
 * to match is itself a failing test.
 */
export const CONVENTIONS = ['mechanisms-do-not-log'] as const;
