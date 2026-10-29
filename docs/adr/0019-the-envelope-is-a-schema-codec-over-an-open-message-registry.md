# 19. The envelope is a Schema codec over an open message registry

- Status: Accepted
- Date: 2026-10-28
- Area: platform
- Read when: reading or writing an envelope on HTTP, the bus or the stream, adding a message type or a domain event, deciding who may receive a message, or about to cast a parsed body to its type

## Context

`readEnvelope` and `assertEnvelope` check the `meta.type` discriminant and then
cast (`packages/ts/core/src/envelope/read-envelope.ts`). No transport validates
`data`: the bus consumer, the SSE frame writer and the browser's event-source
channel each parse JSON and trust the shape, so a payload that drifted between
publisher and consumer fails deep inside a handler, or does not fail at all.
Business contracts re-validate their own payloads by hand to make up for it.

Core also owns a **closed** `EntifixEnvelopeType` union of eleven members
(`types.ts`), four of them transaction-shaped. A package that wants a new kind of
message has to change core. The methods omit `PATCH`. And nothing on a message
says **which aggregate version** it describes, or **who may receive it** — a
question the stream to the browser cannot answer by convention.

## Decision

### One framing on every transport

HTTP bodies, bus messages and stream frames are the same envelope. `meta`
describes the message and `data` describes the occurrence.
`meta.event.id` is the dedup key; `meta.event.correlationId` is the flow key.

### Every read decodes

Every reader decodes `data` against the Schema registered for its `meta.type`
— and, for an event, its `meta.event.name`. `decodeEnvelope(unknown)`,
`encodeEnvelope`, and `Envelope.codec(schema)` replace the casting readers. An
unregistered type, or a body that fails its schema, is a **`protocol`** failure
of [ADR 0013](0013-failures-are-typed-values-decided-at-the-shell.md), never a
cast:

| Path                                 | A decode failure is                                  |
| ------------------------------------ | ---------------------------------------------------- |
| bus                                  | poison: quarantined, never redelivered               |
| browser                              | dropped and counted                                  |
| HTTP client reading a peer's answer  | a typed failure returned to the caller               |
| a service reading a caller's request | `InvalidEnvelope`, a `400` — `decodeRequestEnvelope` |

The last row is the one exception to `protocol`, and it is about blame: a
peer's malformed answer is a `502`, a caller's malformed request is that
caller's fault.

### The registry is open

Packages register their schemas **at module load**, keyed by name. Core
registers only what core owns: `entity`, `entityCollection`, `entityPage`,
`entityMetadata` and `entityFacets`, and resolves `event` by its
`meta.event.name`. `command` is registered by `@entifix/transactions`, because
its shape is a transaction command and is defined there. A name registered twice with the **same**
schema is accepted, so a hot reload re-runs safely; a name registered twice with
**different** schemas throws.

A registration also states what the message requires of `meta`: `versioned`,
and whether an audience is `required` (the default) or `none`. A publisher is
refused at encode when a requirement is unmet, so the mistake surfaces at the
write rather than at a consumer.

The four transaction-shaped discriminants — `transactionAccepted`,
`transactionRecord`, `sagaResult`, `sagaInstance` — leave core and are
registered by `@entifix/transactions` until
[#127](https://github.com/r10c-technologies/entifix/issues/127) deletes them.

### Version and audience on the message

- **`meta.version`** is required on every message that bears an entity: the
  aggregate version it describes, the one
  [ADR 0018](0018-one-outbox-ordered-per-aggregate.md)'s consumers discard
  older versions by.
- **`meta.audience`** is `{ kind: 'organization' | 'party' | 'flow', id, digest? }[]`.
  An **empty audience is delivered to nobody**: the stream fails closed rather
  than broadcasting what nobody declared a recipient for. A `flow` entry carries
  the digest of the flow capability an anonymous holder presents.
- An asynchronous failure carried in `data` uses the problem encoding of ADR 0013,
  with `code` and `category`.

### `PATCH` joins the methods

`EntifixEnvelopeMethod` gains `PATCH`, for partial updates and their links.

## Consequences

- A payload that drifts between publisher and consumer fails at the edge of the
  consumer with a `protocol` failure, on every transport the same way.
- The hand re-validation in consumers' contract packages can be deleted once
  their events are registered.
- `readEnvelope`, `assertEnvelope` and `readEventEnvelope` are removed in the
  same release, a breaking change listed in the changelog.
- **Checks:** core exports no reader that returns an un-decoded body; a
  duplicate registration with a different schema throws; an audience-less
  message is undeliverable, proven by a contract test.
