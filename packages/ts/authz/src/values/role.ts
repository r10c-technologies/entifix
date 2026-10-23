import { EntifixLogicError } from '@entifix/core';

/**
 * A host's role ladder: its roles in rank order, and the assignment rule bound
 * to them ([ADR 0007](../../../../../docs/adr/0007-the-host-supplies-the-role-ladder.md)).
 *
 * The rungs are the host's — which roles exist is one product's hierarchy, and
 * a framework that declared them would have decided it for every adopter. The
 * rule over them is the framework's: a principal may assign a role at or below
 * its own highest rank, and a principal carrying no recognised role can assign
 * nothing. That rule is why a ladder exists at all; a host that wants another
 * one wants a policy, which `GrantTable` and `can` already are.
 *
 * The ladder is the one attribute that rides in the access token, and an
 * ordered tier is what makes the escalation rule expressible without a policy
 * language.
 */
export interface RoleLadder<TRole extends string> {
  /** Every role, from the lowest rung to the highest. Order is rank. */
  readonly roles: readonly TRole[];
  /** What a self-registered account starts as; never assignable by the caller. */
  readonly defaultRole: TRole;
  /** Seniority. Higher wins; used only for the assignment rule, never for grants. */
  readonly rank: Readonly<Record<TRole, number>>;
  /** Narrow an unknown value — a request body, a stored document — to a role. */
  isRole(value: unknown): value is TRole;
  /**
   * The highest rank among the roles a principal carries, or `-1` when it
   * carries none, or only unrecognised ones — which can never satisfy an
   * assignment.
   */
  highestRank(roles: readonly string[]): number;
  /**
   * May an actor create or promote someone to `target`? At or below the
   * actor's own rank, so the second rung mints its own rung and the first but
   * never the third, and a caller with no roles mints nothing.
   */
  canAssignRole(actorRoles: readonly string[], target: TRole): boolean;
}

/** The role union a ladder was defined over. */
export type RoleOf<TLadder> =
  TLadder extends RoleLadder<infer TRole> ? TRole : never;

export interface RoleLadderOptions<TRole extends string> {
  /** Defaults to the lowest rung. */
  readonly defaultRole?: TRole;
}

/**
 * Define a ladder, once, in whichever package a host keeps its grant table:
 *
 * ```ts
 * export const ladder = defineRoleLadder(['user', 'admin', 'owner'] as const);
 * export type Role = RoleOf<typeof ladder>;
 * ```
 *
 * ⚠️ **An empty ladder and a repeated rung throw here**, at definition rather
 * than at the first assignment: both make rank meaningless, and both would
 * otherwise fail in silence — an empty ladder refusing every assignment, a
 * repeated rung ranking itself by whichever copy was read last.
 */
export const defineRoleLadder = <
  const TRoles extends readonly [string, ...string[]],
>(
  roles: TRoles,
  options: RoleLadderOptions<TRoles[number]> = {},
): RoleLadder<TRoles[number]> => {
  type TRole = TRoles[number];

  if ((roles as readonly string[]).length === 0) {
    throw new EntifixLogicError(
      'A role ladder needs at least one rung.',
      undefined,
      { roles },
    );
  }
  const repeated = roles.filter((role, index) => roles.indexOf(role) !== index);
  if (repeated.length > 0) {
    throw new EntifixLogicError(
      `A role ladder names each rung once; repeated: ${[...new Set(repeated)].join(', ')}.`,
      undefined,
      { roles, repeated },
    );
  }

  const defaultRole = options.defaultRole ?? (roles[0] as TRole);
  if (!(roles as readonly string[]).includes(defaultRole)) {
    throw new EntifixLogicError(
      `The default role "${defaultRole}" is not a rung of the ladder.`,
      undefined,
      { roles, defaultRole },
    );
  }

  const rank = Object.fromEntries(
    roles.map((role, index) => [role, index]),
  ) as Record<TRole, number>;

  const isRole = (value: unknown): value is TRole =>
    typeof value === 'string' && Object.hasOwn(rank, value);

  const highestRank = (carried: readonly string[]): number =>
    carried.reduce(
      (highest, role) =>
        isRole(role) ? Math.max(highest, rank[role]) : highest,
      -1,
    );

  return {
    roles,
    defaultRole,
    rank,
    isRole,
    highestRank,
    canAssignRole: (actorRoles, target) =>
      highestRank(actorRoles) >= rank[target],
  };
};
