import type {
  VerifiedContext,
  VerifiedFacts,
} from '../resolve/verified-context.js';

/**
 * Builds a {@link VerifiedContext} from facts a shell has verified.
 *
 * ⚠️ The only constructor, and deliberately on a subpath of its own: a tier-2
 * adapter or a tier-5 double may not import it, so nothing below the shell can
 * mint a context a resolver would trust.
 */
export const verifiedContext = (facts: VerifiedFacts): VerifiedContext =>
  ({ ...facts }) as VerifiedContext;
