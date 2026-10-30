import {
  type Action,
  permissionForEntity,
  type PolicyDecisionTag,
  type ServiceCrossingPolicyTag,
} from '@entifix/authz';
import type {
  RepositoryScope,
  RequestPrincipal,
  TokenServiceTag,
  VerifiedContext,
} from '@entifix/business';
import type { Entity, EntityConstructor, FilterGroup } from '@entifix/core';
import type { Effect } from 'effect';

import {
  requireCrossing,
  requireOrganization,
  requirePermission,
  requireServiceCrossing,
  type ServiceCrossingTokenTag,
  withVerifiedContext,
} from './auth/index.js';

/**
 * Who may reach a route, and where the organization a per-organization store
 * needs comes from.
 *
 * - `public` — anybody; nothing is checked and no organization is known.
 * - `permission` — a verified session holding the permission the entity
 *   derives for the verb.
 * - `organization` — the same, plus the session's active organization, which
 *   is what a per-organization store opens.
 * - `crossing` — the fleet's crossing token and no session at all. With
 *   `organization: true` the caller names the organization in a header, which
 *   only a caller that has proved it is the fleet may do.
 */
export type EntityRouteGuard =
  | { readonly kind: 'public' }
  | { readonly kind: 'permission' }
  | { readonly kind: 'organization' }
  | { readonly kind: 'crossing'; readonly organization: boolean };

/** What a route learned about its caller from its guard. */
export interface EntityRouteContext extends RepositoryScope {
  readonly principal?: RequestPrincipal;
  /** The caller's verified context, built by the guard from the principal. */
  readonly verified?: VerifiedContext;
}

/**
 * Which records of an entity a caller may see.
 *
 * `filter` narrows a list and `includes` decides a by-id read — both are
 * needed, because `id` is the one member no query can name. `'none'` is a
 * caller who holds the read grant and owns nothing: an empty page and a `404`,
 * never a `403`, because owning no records is not an error.
 */
export type EntityReadScope<T extends Entity> =
  | 'all'
  | 'none'
  | {
      readonly filter: FilterGroup<T>;
      readonly includes: (entity: T) => boolean;
    };

/**
 * What a route needs from the host for its guard: a session's services always
 * (a `$metadata` read and a session guard both read the caller), the fleet's
 * crossing services only when a guard is a crossing.
 */
export type GuardServices<G extends EntityRouteGuard> =
  | TokenServiceTag
  | PolicyDecisionTag
  | (G extends { readonly kind: 'crossing' }
      ? ServiceCrossingTokenTag | ServiceCrossingPolicyTag
      : never);

/**
 * Runs `use` behind `guard`, checking the permission the entity derives for
 * `action` — the one place a derived route turns a stated guard into the
 * check that enforces it, so the entity routes and the facet route cannot
 * enforce the same guard differently.
 */
export const guardRoute = <T extends Entity, A, E, R>(
  entityConstructor: EntityConstructor<T>,
  guard: EntityRouteGuard,
  action: Action,
  use: (context: EntityRouteContext) => Effect.Effect<A, E, R>,
) => {
  const permission = permissionForEntity(entityConstructor, action);
  // Every guard ends here: the context is built once, from what the guard
  // verified, and provided to everything the route runs.
  const verify = (context: EntityRouteContext) =>
    withVerifiedContext(context.principal, verified =>
      use({ ...context, verified }),
    );
  switch (guard.kind) {
    case 'public':
      return verify({});
    case 'permission':
      return requirePermission(permission)(principal => verify({ principal }));
    case 'organization':
      return requireOrganization(permission)((organizationId, principal) =>
        verify({ organizationId, principal }),
      );
    case 'crossing':
      return guard.organization
        ? requireServiceCrossing(permission)(organizationId =>
            verify({ organizationId }),
          )
        : requireCrossing(permission)(verify({}));
  }
};
