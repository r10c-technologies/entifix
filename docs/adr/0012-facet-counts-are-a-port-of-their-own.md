# 12. Facet counts are a port of their own

- Status: Accepted
- Date: 2026-10-26
- Revised: 2026-10-29 by [ADR 0020](0020-endpoints-are-descriptors-and-the-shell-builds-an-httpapi.md) — `$facets` is an endpoint of `entityApi`, registered before `/:id`; `makeEntityFacetRoutes` stays until every consumer has moved
- Area: adapters
- Read when: a listing has to show how many records each filter choice would keep ("Aurora (12)"), adding a count or an aggregation to a store, or about to put counts on `EntityPage` or a method on `EntityRepository`

## Context

A shop's filter panel shows, beside each choice, how many results it would
keep. Nothing in the framework could answer that: `load` returns a page and a
total, nothing per value, and a consumer that wanted the numbers had to load
every record and count them itself, or build a read model of its own.

The counts a panel shows are also not the counts of the current result. If a
buyer picks one brand, the other brands must keep their numbers, or picking one
zeroes the rest and the panel can only be used once. So each facet is counted
under every filter **except its own** — disjunctive faceting. The filters
differ per facet, and the facets differ per page.

Three places could hold it:

- **On the page** — `EntityLoadRequest.facets` in, `EntityPage.facets` out. One
  round trip, but it widens the one contract every adapter shares, and an
  adapter that ignored the new field would answer a page with no counts that no
  one could tell from a page with nothing to count.
- **On the repository** — a fifth method. Every repository, every double and
  every consumer's fake has to grow it, or it becomes optional and fails the
  same silent way.
- **A port of its own.**

## Decision

**Counting is its own port, `EntityFacetCounter`, beside the repository and
never part of it.**

- `count(queries)` takes one `EntityFacetQuery` per member, `{ member, filtering }`,
  and answers the values each member holds and how many records hold each one.
  **Each facet carries its own filtering**, which is how disjunction is
  expressed: the caller sends each facet its search minus its own choice. The
  counter has no notion of which filter belongs to which facet, because that is
  the caller's to know.
- It is opened per request by `EntityFacetCounterFactoryTag`, as the repository
  is by `EntityRepositoryFactoryTag` (ADR 0010), with the same refusal of a
  per-organization store asked for no organization.
- `makeEntityFacetRoutes` mounts `GET <entity>/$facets` beside, not inside,
  `makeEntityRoutes`. It is the only route set that **requires** the counter
  factory, so a host that mounts it without binding a counter fails to compile,
  and a host that never counts binds nothing.
- The wire is a repeated `facet=<member>` with each facet's filtering as RSQL
  under `rsql.<member>`, parsed against the entity's metadata. **Only a
  `filterable` member may be counted**: a count reveals the values a member
  holds, which is a question about what a filter would choose between. A
  `localized` member and a collection member are therefore never countable over
  the wire, the second because no collection member is ever filterable.
- A read scope is conjoined into every facet's filtering, never substituted, so
  no query string counts past it — the rule `list` already follows.
- The semantics are Mongo's `$facet` of `$match`, `$unwind` and `$group`: an
  array member counts each element, a missing or `null` value is not counted, a
  value that is not a string, number or boolean is dropped, and a value no
  record holds is absent rather than `0`. The order is by count, highest first,
  then by value. `describeEntityFacetCounterContract` asserts all of it against
  the in-memory counter, the static one, the Mongo adapter over its fake driver
  and the REST adapter over the wire.

Implementations: `makeMongoFacetCounter` (every facet in one aggregation, one
round trip), `makeStaticFacetCounter`, `makeInMemoryFacetCounter`, and
`buildEntityRestAdapterFacets` for a browser or a server component reading
another service.

## Consequences

- A listing that shows counts makes two requests, the page and the counts,
  which a server component sends in parallel. They are two reads, so under
  concurrent writes they may describe slightly different moments.
- There is no SQL counter yet. A Postgres store does not bind the port until
  one is written, and a route that needs it does not compile against that store
  until then.
- A count is as expensive as the `$match` it runs, once per facet inside the
  one aggregation. A store that counts on a hot path wants an index on each
  counted member.
- Ranges and toggles are not counted. A count per price bucket would be a
  different query (`$bucket`) and is not decided here.
