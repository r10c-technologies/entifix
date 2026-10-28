# 10. Entity routes are derived, and the repository comes from context

- Status: Accepted
- Date: 2026-10-25
- Revised: 2026-10-26 — naming the services a route needs no longer widens its guard type: `makeEntityRoutes.for<R>()` names them, and the guard type parameter defaults to `never`
- Revised: 2026-10-26 — facet counts get a route set of their own beside these, `makeEntityFacetRoutes`, bound through `EntityFacetCounterFactoryTag` the way these are bound through the repository factory ([ADR 0012](0012-facet-counts-are-a-port-of-their-own.md))
- Revised: 2026-10-28 by [ADR 0013](0013-failures-are-typed-values-decided-at-the-shell.md) — the derived routes fail with core failures through `respond` and answer `application/problem+json`; `prepare` refuses with an `EntifixFailure` rather than an `EntityRouteRefusal`
- Area: platform
- Read when: writing a list, read, create, update or delete route for an entity, a route's links name a verb that answers `404`, or a route builds its own repository from a database handle

## Context

Every service written on the shell hand-wrote the same five routes for each
entity: parse the load request from the query string, run the load, get, save or
delete use case, wrap the result in an envelope, attach links, and map the
errors to `400`, `404` and `500`. The example service did it too, which made it
the second binding inside the framework and the first consumer's seven copies
the evidence of what was generic.

The copies varied along a small number of axes — which verbs, who may call
them, which database, which records a reader sees, what a save must pass — and
drifted along the ones nobody stated: links kept by hand named verbs a service
did not serve, and scope parameters were threaded through routes that never
used them.

They also each built their own repository: `makeMongoRepository(db, Entity)`
inside the handler. That is what tied a generic route to one engine and one way
of finding the database.

## Decision

### The routes are derived from the entity and a stated configuration

`makeEntityRoutes(Entity, options)` mounts `$metadata` and any of `list`,
`get`, `create`, `update`, `delete`. What varies is stated:

- **`verbs`** — which exist. The links are derived from them, so a link can
  only name a verb that is mounted.
- **`guard`** — `public`, `permission`, `organization`, or `crossing` with or
  without a caller-named organization; one for every verb or split by read and
  write. The permission is derived from the entity and the verb.
- **`scope`** — which records a reader sees, as a filter **conjoined** onto the
  parsed request (never substituted, so no `or` in a query can widen it) plus a
  predicate for a by-id read. A reader who owns nothing gets an empty page and a
  `404`: owning no records is not an error, and a `403` on a record would
  confirm it exists.
- **`prepare`** — what a save must pass, able to change the record or refuse it
  with a status and a code.

What never varies is the wire: the load request is parsed against the entity's
own `filterable`/`sortable` metadata, every answer is an envelope, an update
takes its id from the path, and the error bodies have one shape. A `scope` is
server code, so its filter may also name a path into an embedded array
(`items.vendorId`), which no client request can: the parser refuses anything
that is not a declared member.

### Naming the services keeps the guard inferred

A route set whose `override`, `scope` or `prepare` handlers need services of the
host's names them as `R`. TypeScript infers no type argument once a caller
names one, so a single call `makeEntityRoutes<T, R>(…)` would default the guard
type too; when that default was every guard kind, a session-guarded route
required the crossing token and policy, and the host failed to typecheck far
from the call. So the guard type parameter defaults to `never`, which refuses
that call at its `guard`, and `makeEntityRoutes.for<R>()(Entity, options)`
names `R` alone while the entity and the guard stay inferred from the value.

### The escape hatch is per verb, and keeps the derivation

`override` replaces one verb's handler with a hand-written one that still runs
under the derived guard and receives the derived links. A route that is not
one of the five verbs is written beside the set as it always was.

### The repository comes from context

The new `EntityRepositoryFactory` port (in `@entifix/business`) opens a
repository for an entity and a request's scope. The host provides it at
composition: over one database, or over the requesting organization's own,
resolved per request. A factory over a per-organization store **refuses** a
request that names no organization — a default organization is somebody else's
data.

The port sits at tier 1 so that a datastore adapter can implement it without
reaching up into the shell.

## Consequences

- A service's generic surface is one call per entity, and a guard, scope or
  verb change is a one-line edit with no handler to keep in step.
- Generic routes no longer name an engine. The same route set runs over any
  adapter that provides the factory.
- The wire is fixed by the framework: a host that wants a different error body
  or a `201` on create overrides the verb rather than configuring the shape.
