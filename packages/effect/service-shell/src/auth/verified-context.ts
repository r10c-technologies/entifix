import { type VerifiedContext, VerifiedContextTag } from '@entifix/business';
import { verifiedContext } from '@entifix/business/verified';
import { Context, Effect, Option } from 'effect';

import type { RequestPrincipal } from './require-principal.js';

/**
 * The configuration dials a resolver's predicates may read, provided by the
 * composition root. Optional: a service that resolves nothing on a dial
 * provides none, and its contexts carry an empty `config`.
 */
export class VerifiedContextConfigTag extends Context.Service<
  VerifiedContextConfigTag,
  Readonly<Record<string, unknown>>
>()('@entifix/service-shell/VerifiedContextConfig') {}

/**
 * The verified context of a caller: what their verified token says, and the
 * service's dials — never anything the request carries
 * ([ADR 0015](../../../../../docs/adr/0015-composed-flows-and-use-case-resolution.md)).
 * No principal is an anonymous caller: no organization, no party, nothing held.
 */
export const verifiedContextOf = (
  principal: RequestPrincipal | undefined,
  config: Readonly<Record<string, unknown>> = {},
): VerifiedContext =>
  verifiedContext({
    ...(principal?.organizationId === undefined
      ? {}
      : { organizationId: principal.organizationId }),
    ...(principal?.partyId === undefined ? {} : { partyId: principal.partyId }),
    ...(principal?.partyRole === undefined
      ? {}
      : { partyRole: principal.partyRole }),
    entitlements: principal?.entitlements ?? [],
    roles: principal?.roles ?? [],
    flags: [],
    config,
  });

/**
 * Runs `use` with the caller's verified context built and provided as
 * {@link VerifiedContextTag} — the one place a request's context is made.
 */
export const withVerifiedContext = <A, E, R>(
  principal: RequestPrincipal | undefined,
  use: (verified: VerifiedContext) => Effect.Effect<A, E, R>,
): Effect.Effect<A, E, Exclude<R, VerifiedContextTag>> =>
  Effect.gen(function* () {
    const config = yield* Effect.serviceOption(VerifiedContextConfigTag);
    const verified = verifiedContextOf(
      principal,
      Option.getOrElse(config, () => ({})),
    );
    return yield* use(verified).pipe(
      Effect.provideService(VerifiedContextTag, verified),
    );
  });
