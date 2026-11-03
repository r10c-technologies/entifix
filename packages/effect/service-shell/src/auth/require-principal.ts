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
import { ACCESS_COOKIE } from '@entifix/core';
import { Effect, Option } from 'effect';
import { HttpServerRequest } from 'effect/http';

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

/**
 * Resolve the caller's principal from the request, or `None`. Reads the token
 * from the `entifix_at` cookie (the Next app forwards it) or an
 * `Authorization: Bearer` header and verifies it statelessly via
 * {@link TokenServiceTag} — no store round trip on the hot path.
 */
export const resolveRequestPrincipal = Effect.gen(function* () {
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

/** Whether the policy lets `principal` do what `permission` names. */
export const permits = (principal: RequestPrincipal, permission: Permission) =>
  Effect.gen(function* () {
    const { resource, action } = parsePermission(permission);
    const policy = yield* PolicyDecisionTag;
    return policy.decide({
      subject: { roles: principal.roles },
      resource,
      action,
    });
  });
