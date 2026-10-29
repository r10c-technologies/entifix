import {
  parsePermission,
  type Permission,
  PolicyDecisionTag,
} from '@entifix/authz';
import {
  type RequestPrincipal,
  type TokenClaims,
  TokenServiceTag,
} from '@entifix/business';
import { ACCESS_COOKIE, Forbidden, Unauthenticated } from '@entifix/core';
import { Effect, Option } from 'effect';
import { HttpServerRequest } from 'effect/http';

import { refuse } from './failures.js';

/** Extract a bearer token from an `Authorization` header, if present. */
const bearerToken = (authorization: string | undefined): string | undefined => {
  if (authorization === undefined) {
    return undefined;
  }
  const [scheme, value] = authorization.split(' ');
  return scheme?.toLowerCase() === 'bearer' ? value : undefined;
};

/** Rebuild the request principal from verified token claims. */
const claimsToPrincipal = (claims: TokenClaims): RequestPrincipal => ({
  userId: claims.userId,
  subject: claims.subject,
  sessionId: claims.sessionId,
  roles: claims.roles,
  // The organization comes from the *verified* token and nowhere else — never
  // from a route parameter, a query string or a body, all of which the caller
  // controls. That is what makes tenant isolation a property of the session
  // rather than of every handler remembering to check.
  organizationId: claims.activeOrganizationId,
  // Same rule, same reason: it comes from the verified token, never from
  // anything the caller can set on the request.
  partyRole: claims.partyRole,
  partyId: claims.partyId,
  // `TokenClaims` carries an index signature, so `exp` arrives as `unknown`
  // even though jose always sets it — hence the guard rather than a cast.
  expiresAt: typeof claims.exp === 'number' ? claims.exp : undefined,
  entitlements: claims.entitlements ?? [],
  // Rich/volatile attributes are not in the token; a handler that needs them
  // reads the session store by `sessionId`.
  attributes: {},
});

// `code` is a key in the shared `errors` catalog; `error` stays English for
// logs. `permission` is deliberately still in the 403 — it says which grant was
// missing, which is diagnostic, not a leak.
const unauthenticated = refuse(new Unauthenticated());

const forbidden = (permission: Permission) =>
  refuse(new Forbidden({ permission }));

/**
 * Resolve the caller's principal from the request, or `None`. Reads the token
 * from the `entifix_at` cookie (the Next app forwards it) or an
 * `Authorization: Bearer` header and verifies it statelessly via
 * {@link TokenServiceTag} — no store round trip on the hot path.
 */
const resolvePrincipal = Effect.gen(function* () {
  const req = yield* HttpServerRequest.HttpServerRequest;
  const token =
    req.cookies[ACCESS_COOKIE] ?? bearerToken(req.headers['authorization']);
  if (token === undefined) {
    return Option.none<RequestPrincipal>();
  }

  const tokens = yield* TokenServiceTag;
  const claims = yield* tokens.verify(token).pipe(Effect.option);
  return Option.map(claims, claimsToPrincipal);
});

/**
 * Guard a handler behind a valid access token — authentication only. Any
 * missing or invalid token is a `401`; the wrapped handler's own errors are
 * left intact.
 */
export const requirePrincipal = <A, E, R>(
  use: (principal: RequestPrincipal) => Effect.Effect<A, E, R>,
) =>
  Effect.gen(function* () {
    const principal = yield* resolvePrincipal;
    if (Option.isNone(principal)) {
      return yield* unauthenticated;
    }
    return yield* use(principal.value);
  });

/**
 * Guard a handler behind a permission. Authenticates as above, then asks
 * {@link PolicyDecisionTag} whether this subject may perform the action — so
 * the two failure modes stay distinguishable: `401` means "sign in", `403`
 * means "signed in, not allowed".
 *
 * **This is the authorization boundary.** Filtering a nav menu or hiding a page
 * is presentation; a route that skips this guard is open regardless.
 */
export const requirePermission =
  (permission: Permission) =>
  <A, E, R>(use: (principal: RequestPrincipal) => Effect.Effect<A, E, R>) =>
    Effect.gen(function* () {
      const principal = yield* resolvePrincipal;
      if (Option.isNone(principal)) {
        return yield* unauthenticated;
      }

      const { resource, action } = parsePermission(permission);
      const policy = yield* PolicyDecisionTag;
      const allowed = policy.decide({
        subject: { roles: principal.value.roles },
        resource,
        action,
      });
      if (!allowed) {
        return yield* forbidden(permission);
      }

      return yield* use(principal.value);
    });
