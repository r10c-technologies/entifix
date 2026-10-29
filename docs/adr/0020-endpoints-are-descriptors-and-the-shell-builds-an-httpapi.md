# 20. Endpoints are Schema descriptors, and the service shell builds an HttpApi

- Status: Accepted
- Date: 2026-10-29
- Area: platform
- Read when: adding a route to a service, guarding one, writing an error body or a status by hand, building a link to a verb, a client decoding an error by its status, or about to import `effect/http` or `effect/http-api` outside the service shell

## Context

Every route a host serves is an `HttpRouter` value built by hand
(`entity-routes.ts`), wrapped in a guard higher-order function
(`entity-route-guard.ts`, `auth/require-*.ts`) and answering through
`respond` (ADR 0013). Three things follow from that, and all three show in the
first consumer:

- **A route's contract is nowhere.** Its parameters, body, success shape and
  failures live inside a handler. A client hand-decodes the body, and an
  OpenAPI document cannot be produced.
- **A cell that owns a route has to import the transport.** A route set is an
  `HttpRouter` plus the guard HOFs, so a business cell imports `effect/http` and
  the service shell. ADR 0006 asks a cell to export a contract, and it is
  exporting a mechanism instead.
- **Verbs and their links drift.** A `@useCase()` verb is routed by a path
  someone wrote, and its link is written by someone else. The first consumer has
  a link table that maps `cancel` to `/cancellation`.

Effect ships `effect/http-api`: a typed endpoint declaration, a builder that
serves it, middleware, a generated client and OpenAPI. A probe against 4.0.6
showed it fits **with caveats**:

- `HttpApiGroup` has no `addError`;
- an error's status defaults to 500;
- a bad parameter or body answers an **empty** `400`;
- a defect answers an **empty** `500`, and so does an error the endpoint did not declare, because encoding it fails and dies;
- a security scheme decodes a missing credential as an **empty `Redacted`**, which a middleware treats as present;
- an unmatched path answers an empty `404`.

## Decision

### A descriptor is Schema only; the shell turns it into an endpoint

A cell declares each endpoint with `defineEndpoint` from `@entifix/core`:

```ts
{ name, method, path, params?, query?, payload?, headers?, success,
  errors: [FailureClass, …], guard, idempotent?: 'unit' | 'edge', useCase? }
```

- `errors` admits only `EntifixFailure` classes (ADR 0013), so a refusal that
  has no category does not compile.
- `implement(descriptor, handler)` types the handler from the descriptor. The
  handler is a plain `Effect` over the decoded `{ params, query, payload }`. It
  may fail with the declared failures or with any **technical** failure, which
  every endpoint carries implicitly.
- A descriptor carries **no status, content type or HTTP annotation**, so core
  never depends on `effect/http*`.
- A payload is JSON unless it says otherwise. `TextBody` is the exact text
  that arrived, for an endpoint authenticated by a signature over those bytes
  — a decoded object re-serialised is a different byte sequence, so the MAC
  would not verify — and `formBody(fields)` is a form-encoded one, for a
  caller a specification makes post a form. Each is a schema carrying a
  marker the shell reads; `headers` names the request headers a handler
  reads, and a header it does not name is not its input.

The service shell's `serveEndpoints({ name, groups, policy })` returns two
things built from the same descriptors, so they cannot disagree:

- the `HttpApi`;
- the layer that serves it.

For each endpoint the shell:

- builds the `HttpApiEndpoint`;
- turns every declared failure class into a problem codec annotated with the status the `FailurePolicy` gives its tag or category, plus `application/problem+json`;
- attaches the guard's middleware.

### One middleware answers every failure, and it is the existing encoder

The shell adds one middleware to every endpoint, outermost, that does what
`respond` did for hand routes:

- provides the deadline from `x-request-timeout-ms`;
- turns `HttpApiSchemaError` into `invalid` with `errors[]`;
- turns a typed failure into `problemResponse` under the policy, logged at the policy's level;
- turns a defect into a `500` problem carrying a `traceId` and no stack.

It catches **defects and failures separately**, never `catchCause`, so an
interruption still interrupts. There is one encoder, `problemResponse`, for hand
routes and descriptors alike.

The declared problem codecs therefore exist for the contract — OpenAPI, the
typed client, the contract test. They are not the wire path. A failure the
endpoint did not declare still answers its problem rather than the empty `500`.

A router-level net answers an unmatched path with a `404` problem and an
encoding failure with a `500` problem.

### Six guard kinds, exactly one per endpoint

| Kind           | Credential                                                                            | Provides                                    |
| -------------- | ------------------------------------------------------------------------------------- | ------------------------------------------- |
| `public`       | none                                                                                  | —                                           |
| `session`      | the session cookie                                                                    | `RequestPrincipalTag`, the verified context |
| `permission`   | the session cookie, plus the descriptor's permission through `PolicyDecisionTag`      | the same                                    |
| `organization` | a session with an active organization, plus the permission                            | the same, plus `OrganizationIdTag`          |
| `crossing`     | `x-crossing-token` plus the permission; `organization: true` adds `x-organization-id` | `OrganizationIdTag` when named              |
| `fleet`        | the shared service token                                                              | —                                           |

- Each kind is one `HttpApiMiddleware.Service` that reads the request
  itself. It does not use a security scheme, because a scheme decodes a
  missing credential as an empty `Redacted` and the first scheme that decodes
  wins.
- Every one of them fails `unauthenticated` on an **empty** credential, so the
  empty `Redacted` never reaches a decision.
- A request carrying both a session and a crossing token to a crossing endpoint
  is refused: two accepted credentials make the weaker one the security level.
- The request-context tags (`RequestPrincipalTag`, `OrganizationIdTag`,
  `IdempotencyKeyTag`) live in `@entifix/business`, so a handler reads them
  without importing the shell.

### Idempotency is declared, and one layer dedups each write

`idempotent` says which layer remembers a key:

- **`'unit'`**: the shell decodes `Idempotency-Key` into `IdempotencyKeyTag`
  and nothing more. The handler's unit of work claims the key in the same
  transaction as its write (ADR 0009) and replays its own answer.
- **`'edge'`**: the shell mounts `requireIdempotencyKey`, and the
  `IdempotencyStore` remembers the response. This is for handlers that write
  through no unit of work.

A write is never recorded twice, by both layers.

The fingerprint hashes the method, the **concrete** path and the body, not the
route template. Without that, one key reused across two records on the same
route would replay the first record's answer.

### Verbs are derived, and so are their links

A `@useCase()` descriptor declares its `payload`, `success` and `errors`.
`verbEndpoint(UseCase, { guard, handler })` derives the rest:

- the method is `POST`;
- the path is `POST /api/<key>/:id/<useCase>` for `binding: 'entity'`, and `POST /api/<key>/<useCase>` for `collection` and `unbound`;
- the permission comes from `permissionForUseCase`;
- the failure union comes from the descriptor.

One verb registry per mounted entity feeds three things, all filtered by the
same principal check:

- the endpoints;
- the `rel`/`href`/`method` links on every envelope;
- the `$metadata` use-case entries.

Building a group **throws** when an `@useCase()` has no endpoint, or when an
endpoint names an undeclared use case.

### Generic routes move too

An entity's endpoints are **declared** where its domain lives and **served**
by the shell. `defineEntityApi(Entity, entityKey(Entity, 'k'), { verbs, guard,
narrowing?, facets?, prepare?, override?, useCases? })` and `verbEndpoint` are
in `@entifix/business`: a declaration is a value, its handlers take the decoded
request and the caller, and nothing in it needs HTTP. The shell serves it with
`entityApi(declaration, { compositions? })` from service-shell — the
recipes and variants `$metadata` resolves verbs against are composition, so
they are added there and nowhere else. That returns the group for:

- list, get, create, update and delete;
- `$metadata`;
- `$facets`.

So a domain's cell can be held to "descriptors and handlers only" by an import
ban, with no HTTP type to reach for.

`entityKey` returns the literal and throws at load when it differs from
`@entity({ key })`. `$metadata` and `$facets` are registered before `/:id`.

Health, `$service` and `GET /api/$openapi` are served from the built API. One
encoder, one guard implementation, one OpenAPI document. A service that is not
ready answers a `notReady` problem with the failing probes rather than a body of
its own. `$service` and `$openapi` are behind the fleet token, and neither is
mounted for a service that names none.

### A client decodes by code, never by status

`@entifix/rest/endpoint` builds a client from the **descriptors**, not from the
server's API. Any problem body is decoded by its `code` against the
descriptor's failure union, and an unknown code or a body that is not a problem
is `protocol`. The status table therefore stays the shell's private business,
and a host that overrides one status breaks no client.

### `effect/http*` is confined

`effect/http` and `effect/http-api` may be imported only under:

- `packages/effect/service-shell/src`;
- `packages/ts/rest-client/src/endpoint`.

A lint rule enforces it, with a planted violation.

The `HttpRouter` route makers, `routeFailure` and the guard HOFs stay exported
until every consumer has migrated, and then they are deleted (#126).

| Caveat from the probe                          | Answered by                                                 | Checked by                   |
| ---------------------------------------------- | ----------------------------------------------------------- | ---------------------------- |
| no `addError`, 500 default                     | problem codecs annotated from the policy                    | `http-api.contract.spec.ts`  |
| empty `400` on bad input                       | `HttpApiSchemaError` → `invalid` with `errors[]`            | the contract spec            |
| empty `500` on a defect or an undeclared error | the outermost middleware, defects and failures caught apart | the contract spec            |
| empty `Redacted` reads as present              | every guard refuses an empty credential                     | the contract spec            |
| empty `404` on no route                        | the router-level net                                        | the contract spec            |
| `catchCause` would swallow interruption        | never used                                                  | the contract spec and review |
| `/:id` capturing `$metadata`                   | registered first                                            | the precedence spec          |

## Consequences

- A cell exports descriptors and handlers, with no `effect/http*` and no
  service shell. The consumer's boundary rule can ban both from a cell, and the
  slice shell is the only place a status or a guard implementation lives.
- The OpenAPI document and the typed client come from the same declaration as
  the server, so neither can drift from it.
- `effect/http-api` is `@stability unstable`. The contract spec pins every
  behaviour this ADR relies on, so an `effect` bump that changes one fails
  there rather than in a consumer.
- A verb's path is fixed by its key and binding. A consumer whose verb paths
  were hand-chosen renames them once.
