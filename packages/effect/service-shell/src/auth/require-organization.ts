import type { Permission } from '@entifix/authz';
import type { RequestPrincipal } from '@entifix/business';
import { Effect } from 'effect';

import { NoActiveOrganization, refuse } from './failures.js';
import { requirePermission } from './require-principal.js';

/**
 * `409` rather than `403`: the caller is authenticated and permitted, but the
 * session names no organization, so there is no storage to read. An operator
 * hits this by design — crossing into a tenant is an explicit, audited
 * act-as-organization re-mint, never a widening of the default —
 * and a member of several organizations hits it before choosing one. The `code`
 * is a key in the shared `errors` catalog, so a client renders "select an
 * organization" instead of "forbidden" — a claim a host has to check its
 * catalog against, because for a while it was simply false and the code
 * reached the browser as its own literal text.
 */
const noOrganization = refuse(new NoActiveOrganization());

/**
 * Guard a **tenant-plane** handler: authenticate, check the permission, and
 * require that the session names an organization.
 *
 * **This is the first of exactly two ways a request resolves the organization
 * it acts for, and the only *user-facing* one**.
 * The second is {@link requireServiceCrossing}: an explicit `organizationId`
 * presented with a service token *and* a narrow route permission, for a
 * platform-plane caller acting for an organization it was handed rather than one
 * it picked.
 *
 * There is no third path, no fallback and no operator branch. A request
 * satisfying neither guard never reaches a tenant handle at all, which is what
 * keeps the most sensitive capability in the system from being the *absence* of
 * a condition.
 *
 * The organization is handed to the handler so it can resolve its own storage
 * through a `TenantDatabaseResolver`. Resolution happens **inside the request**
 * — the connection pool is a boot-time `Layer`, and a per-request `Layer` would
 * rebuild the pool per request.
 *
 * Here the value comes from the verified token and nowhere else. A route
 * parameter or a body field naming an organization would be caller-controlled,
 * which is the whole failure this guard exists to prevent — and is exactly why
 * the other path honours a caller-named organization only *after* the caller has
 * proved it is the fleet.
 */
export const requireOrganization =
  (permission: Permission) =>
  <A, E, R>(
    use: (
      organizationId: string,
      principal: RequestPrincipal,
    ) => Effect.Effect<A, E, R>,
  ) =>
    requirePermission(permission)(principal =>
      // `Effect.gen` rather than a ternary: the two branches have different
      // success types, and a conditional expression would unify them against
      // the first one instead of widening. `requirePrincipal` yields for the
      // same reason.
      Effect.gen(function* () {
        if (principal.organizationId === undefined) {
          return yield* noOrganization;
        }
        return yield* use(principal.organizationId, principal);
      }),
    );
