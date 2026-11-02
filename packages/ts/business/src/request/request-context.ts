import { Context } from 'effect';

import type { TokenClaims } from '../tokens/token-service.js';

/**
 * The authenticated subject as a service sees it, rebuilt by the shell from a
 * verified token and nothing else. It lives here rather than in the shell so a
 * handler reads it through {@link RequestPrincipalTag} without importing the
 * transport.
 */
export interface RequestPrincipal {
  readonly userId: TokenClaims['userId'];
  readonly subject: string;
  readonly sessionId: string;
  readonly roles: readonly string[];
  /**
   * The organization this request acts for — the storage routing key, absent
   * for a caller with no tenant scope (a buyer, or an operator). Kept out of
   * `attributes` deliberately: attributes are policy inputs, this decides which
   * database a handler reads.
   */
  readonly organizationId?: string;
  /**
   * Which population the caller belongs to — buyer, vendor staff, or platform
   * staff. Carried so a handler never has to infer it from an absent
   * `organizationId`, which a buyer and an operator share.
   *
   * Context, not a grant: what the caller may *do* still comes from `roles`
   * through the policy decision port.
   */
  readonly partyRole?: string;
  /**
   * The party behind the account — the `Individual` id, absent for an account
   * with no party record.
   *
   * Same rule as the two fields above: it comes from the verified token and
   * never from anything the caller sets on the request. It says *whose* records
   * these are, which is what a route scoping a read to its caller needs; it
   * says nothing about what may be done with them.
   */
  readonly partyId?: string;
  /**
   * When the verified token stops being valid, as a Unix timestamp in seconds.
   *
   * Every REST route is already bounded by it implicitly — verification is
   * stateless, so the next call after expiry simply fails. A **held-open**
   * response has no next call, so a held-open stream reads it and closes the
   * connection there. Absent when the token carries no
   * `exp`, which a signed one always does; the guard is for the type, not for a
   * case the fleet produces.
   */
  readonly expiresAt?: number;
  /**
   * What the caller's active organization was provisioned for, off the
   * verified token. Context for a resolver, never a
   * grant: a variant requires an entitlement before its predicate is read.
   */
  readonly entitlements?: readonly string[];
  readonly attributes: Readonly<Record<string, unknown>>;
}

/**
 * The verified caller of the current request, provided by the shell's
 * `session`, `permission` and `organization` guards
 * ([ADR 0020](../../../../../docs/adr/0020-endpoints-are-descriptors-and-the-shell-builds-an-httpapi.md)).
 * Absent on a `public`, `crossing` or `fleet` endpoint: no session was read.
 */
export class RequestPrincipalTag extends Context.Service<
  RequestPrincipalTag,
  RequestPrincipal
>()('@entifix/business/RequestPrincipal') {}

/**
 * The organization the current request acts for. From the session's active
 * organization on an `organization` endpoint, and from `x-organization-id` on a
 * `crossing` endpoint that lets the caller name it — never from a path, a query
 * or a body.
 */
export class OrganizationIdTag extends Context.Service<
  OrganizationIdTag,
  string
>()('@entifix/business/OrganizationId') {}

/**
 * The request's `Idempotency-Key`, decoded by the shell on an endpoint
 * declared `idempotent: 'unit'`. The handler's unit of work claims it in the
 * same transaction as its write.
 */
export class IdempotencyKeyTag extends Context.Service<
  IdempotencyKeyTag,
  string
>()('@entifix/business/IdempotencyKey') {}
