# 7. The host supplies the role ladder; the screen taxonomy is entifix's

- Status: Accepted
- Date: 2026-10-23
- Area: platform
- Read when: adding a role, changing who may assign whom, building a second host on `@entifix/authz`, or about to add a fifth screen type — the ladder's rungs are the host's and only the rule over them is the framework's, while the four screen types are the framework's own back-office model

## Context

`@entifix/authz` ships two closed vocabularies as constants.

**The role ladder.** `values/role.ts` declares
`Roles = ['user', 'admin', 'super-admin']`, a `ROLE_RANK` over them and
`DEFAULT_ROLE = 'user'`. `isRole`, `highestRank` and `canAssignRole` are written
against that one ladder. The escalation rule they implement is generic — a
principal may assign a role at or below its own highest rank, and a principal
with no recognised role can assign nothing — but the rungs are one product's
hierarchy. [ADR 0001](0001-the-tier-contract-and-the-host-seam.md) calls a host
value baked into framework code a defect, and the grant table beside it already
follows that rule: `GrantTable` is keyed by bare `string`, documented as supplied
by the host and never declared here. The ladder is the one half of authorization
that still is not.

**The screen taxonomy.** `values/screen-type.ts` declares
`ScreenTypes = ['master', 'operation', 'wizard', 'report']`, and much more is
built on it than a list. `@entifix/next-shell`'s sidebar groups by screen type
above domain; a workspace tab address is `master:<key>[:<id>]`, parsed by every
tab kind; the command palette's navigation source and `GuardedNavSection` both
carry the type. Its comment block also carries a host's product names for the
four types, in one language.

The two look alike — a closed `as const` tuple in `values/` — and the question
asked of both was the same: should a second host be able to replace it? The
answer differs because what each one _is_ differs.

## Decision

### The ladder's rungs are the host's; the rule over them is entifix's

`authz` keeps the **mechanism** and stops declaring the **values**. A host
defines its ladder once, as an ordered tuple from the lowest rung to the
highest, and gets back the typed helpers bound to it:

```ts
export const ladder = defineRoleLadder(['user', 'admin', 'super-admin'] as const);
export type Role = RoleOf<typeof ladder>; // 'user' | 'admin' | 'super-admin'

ladder.roles; //            the tuple, in rank order
ladder.defaultRole; //      the lowest rung, unless `{ defaultRole }` names another
ladder.isRole(value); //    narrows unknown input to Role
ladder.highestRank(roles); // -1 for none or only unrecognised
ladder.canAssignRole(actorRoles, target);
```

- **Order is rank.** A tuple says it once; a rank table beside a list said it
  twice and could disagree with itself.
- **An empty ladder and a duplicate rung throw at definition**, because both make
  rank meaningless and both would otherwise fail silently, at the first
  assignment.
- **The rule does not move.** "At or below your own highest rank, and nothing
  without a recognised role" stays the framework's, because it is the reason a
  ladder exists at all — and a host that wants a different rule wants a policy
  rather than a ladder, which `GrantTable` and `can` already are.
- `Roles`, `ROLE_RANK`, `DEFAULT_ROLE` and the free `isRole`, `highestRank` and
  `canAssignRole` are **removed**, not deprecated. A framework default would be
  exactly the baked-in value this record removes, and 0001 names the versioning
  channel, not a compatibility path, as what carries a breaking change.

Nothing else in the framework names a rung. The service guard, the nav filter
and the browser check all take `roles: readonly string[]` and a `GrantTable`, so
an unknown string can never widen access whichever ladder a host defines.

### The screen taxonomy stays, as the framework's back-office model

The four types are not a host's vocabulary that happens to live here. They are
the model `next-shell` renders, and a host that adopts the back office adopts it:

| Type        | The record came from         | Lifecycle | Verbs              |
| ----------- | ---------------------------- | --------- | ------------------ |
| `master`    | a person authored it         | none      | create, read, edit |
| `operation` | a process produced it        | yes       | domain verbs       |
| `wizard`    | a guided, multi-step entry   | ends      | next, finish       |
| `report`    | nothing — it is an aggregate | n/a       | read only          |

- **The type is the sidebar's top tier, above the domain.** Four fixed entries
  against however many domains a host has, so "where does this screen go" has
  one answer whoever owns it.
- **A verb on a record is not a fifth type.** Every entity can declare verbs, so
  promoting an entity to `operation` because it has one would promote all of
  them; a publish action belongs on a `master` screen.
- **The identifiers are English and deliberately not the obvious words.**
  `query` collides with the query protocol and with `filterable` metadata, and
  `assistant` reads as an AI agent, so the enum says `report` and `wizard`.
  `SCREEN_TYPE_LABEL_KEYS` is the one place that maps them to rendered names.
- **The rendered names are the host's.** The keys stay in the `shell:` catalog
  namespace because `next-shell` renders them, but no product's names for them
  are written in source — a catalog supplies them.

Making the taxonomy generic over a host-supplied type set would mean every tab
kind's address parser, the sidebar's grouping and the palette's source become
generic too. That is a large cost paid for no consumer, and the cost lands on the
grammar every saved tab is written in.

## Consequences

- **Breaking, in `authz`.** The release that removes the constants is a minor on
  the 0.x channel. A host replaces each import with its own ladder, defined once
  in whichever package its grant table lives in.
- `authz`'s own spec defines a ladder of its own and a second one with other
  rungs, and the rule holds over both. That is the proof the rule is not one
  ladder's. The examples carry no authorization at all, so a ladder there would
  be a value nothing reads.
- `screen-type.ts` loses its product names and keeps its reasoning, which this
  record now holds.

## What this record does not decide

How a host's roles relate to its organizations, entitlements or tenancy — a
ladder is one ordering of strings, and what a rung may reach is the grant table's
business. Nor whether a host needs several ladders: one is what every consumer
has needed so far.

## Status

Accepted with the change that added `defineRoleLadder` and removed the
constants, released in **0.6.0**.

The taxonomy half is reopened by one thing only: a host that needs a screen type
the four do not describe, and cannot express as an action on one of them.
