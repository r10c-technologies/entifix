# 21. Server push is a port, served over one multiplexed stream per tab

- Status: Accepted
- Date: 2026-11-02
- Revised: 2026-11-04 — the drain runs on the shutdown **signal** (`ShutdownRegistry.whenTerminating`), not when the adapter's scope finalizes: the server's close runs first and waits for every open response, so a stream drained at finalization was held 20 s and then cut without its `retry:` (measured by r10c's live pass, #492)
- Area: platform
- Read when: pushing anything from a service to a browser, opening a second `EventSource` in one tab, a stream dies when its token expires, a fleet restart makes every browser reconnect at once, deciding who may receive a pushed event, or about to add a control endpoint or a WebSocket beside the stream

## Context

The service shell serves a stream with `sseResponse` (`sse.ts`), a one-shot
writer:

- **No operations.** It sends a keepalive comment every 20 s, no `retry:`, and
  no connection identity. At the token's `exp` it closes silently, so the
  browser reconnects on the old cookie and fails. Nothing drains connections on
  shutdown, and nothing counts them.
- **No interest.** It carries every entity-change event to whoever holds the
  stream. A tab interested in three things opens three streams, or receives
  everything.
- **No resume.** `Last-Event-ID` arrives and is ignored. The client re-reads
  whatever it was showing.

The client port has the same gaps. `ReactiveChannel` (`reactive-channel.ts`) is
`subscribe(listener)` plus `onConnect`, with no topics and no resume, and
`makeEventSourceReactiveChannel(url)` opens one stream per URL.

A host that pushes flow outcomes, record changes and availability to the same
tab needs one transport that is interest-scoped, survives a token expiry, a
redeploy and a missed frame, and never sends one audience's event to another.

## Decision

### Two ports, and the stream is the only thing that carries them

- **Server: `ServerPushTag`**, at `@entifix/service-shell/push`, with the SSE
  adapter at `@entifix/service-shell/push/sse`.
  `open({ audience, topics, cursor })` returns a `Stream` of push messages. The
  host supplies three things:
  - the source of envelopes;
  - an audience filter `(envelope, connection) => boolean`, which **defaults to
    deny**;
  - a resume hook `(cursor, topics)`.
- **Client: `PushChannelTag`**, in `@entifix/react-integration`, with its
  `EventSource` adapter at `/event-source`. It offers
  `subscribe(topic, listener)`, `onConnect` and `onResync`.
- **Commands stay HTTP.** The stream is one-way. A browser never writes through
  it, which is why SSE is enough and why no frame on it needs a reply.
- **The push port is a subpath, not part of `.`.** A domain package and an
  implementation cell must never know a browser exists
  ([ADR 0006](0006-the-public-contract-is-entities-use-cases-and-ports.md)), and
  a subpath is something a host's import ban can name.

### One stream per tab, and the topics are in its URL

- A tab holds **one** `EventSource` per base URL and multiplexes every topic
  over it. The topic grammar is `entity:<key>`, `record:<key>:<id>` and
  `flow:<id>`.
- The topic set travels in the stream's query string, and so do the flow
  capabilities a host hands an anonymous holder. There is **no control POST**
  and **no subscription state shared across replicas**: whichever replica
  answers the request has everything it needs.
- Changing interest **reopens** the stream with `Last-Event-ID`. The reopen is
  debounced, so a screen that mounts five subscriptions reopens once.
- Topics come only from the request URL. The adapter never reads them from a
  frame or a header.
- The client writes the URL as repeated `topic` and `capability` parameters,
  plus `lastEventId` on a reopen. A new `EventSource` cannot set a header, so
  the browser's own `Last-Event-ID` header arrives only on its automatic
  reconnects, and the host reads whichever is present.
- An event frame's `data` is `{ topics, envelope }`: the topics of this
  connection the event matched, and the event as its registered codec encodes
  it. The browser routes on those topics, so it never needs the host's
  `topicsOf`.
- Because the query can carry a capability, **the host's edge must redact the
  stream route's query from its access logs.**

### Who receives an envelope

- The filter runs per connection, per envelope, and fails closed. An envelope
  carrying no audience reaches **no** connection.
- What a member sees, a full snapshot or a hint to re-read, is the host's
  decision in its push projection. The port carries whichever envelope the
  projection produced.

### Operations

- **Heartbeat: 15 s**, exported as `PUSH_HEARTBEAT`. It is short enough to sit
  under a common 30 s idle timeout with room to spare. The host's edge idle
  timeouts must exceed twice this value.
- **`retry:` is randomized per connection**, from a dial range. A fleet restart
  then spreads the reconnects instead of answering them all in the same
  millisecond.
- **Reauth, never a 401 on reconnect.** At `exp − margin`, the adapter sends
  `event: reauth` and closes cleanly. The client refreshes its session and only
  then reopens. An `EventSource` that receives a 401 enters `CLOSED` and never
  retries, so a 401 is a permanently dead tab.
- **Drain.** When the process begins terminating — the signal, through
  `ShutdownRegistry.whenTerminating`, before the server closes — every live
  connection receives a randomized `retry:` and then a clean close; the scope's
  finalizer drains whatever is left. Draining only at finalization is too late:
  the server's close waits for every open response, and a stream never finishes
  by itself, so it was held until the server gave up on it and then cut without
  a `retry:`, every browser reconnecting on its own default at once.
- **Resume through a catch-up hook, not a backlog.** The adapter passes
  `Last-Event-ID` to `resume(cursor, topics)`. The host replays from a read
  model it already has, or answers `resync`, which tells the client to re-read
  that topic. No per-connection buffer is kept, and no replica holds another's
  backlog.
- **Metrics:** a `entifix_push_connections` gauge, and counters for opened,
  closed, drained, reauth and filtered-out frames.
- **HTTP/2 at the cluster edge only.** Six connections per origin under
  HTTP/1.1 is why the stream must be one per tab. Locally, plain HTTP/1.1 with
  one stream per tab is enough.

### The old port lives until its consumers move

`sseResponse`, `sseFrame`, `ReactiveChannel`, `makeEventSourceReactiveChannel`
and `useReactiveInvalidation` stay unchanged beside the new ports. A host
migrates per screen, and the release that deletes the saga runner and the
tracker clients deletes these with them. The new client port is therefore named
`PushChannel` rather than reusing `ReactiveChannel`, so the two can coexist
without a breaking rename.

### A WebSocket adapter later

A same-origin WebSocket handshake carries the session cookie, so a WebSocket
adapter is possible behind the same port. It must check `Origin` against an
**exact allowlist** and reject a handshake with no `Origin` at all, because,
unlike `EventSource`, a WebSocket is not bound by CORS.

## Consequences

- One stream per tab means a tab's interest is visible in one URL, and a
  reconnect storm is bounded by the jittered `retry:` rather than by the number
  of screens.
- No control channel and no shared subscription state means any replica can
  answer any reconnect, at the cost of a reopen whenever interest changes.
- A missed frame costs a read-model read, not a server-side buffer. A host with
  no read model for a topic answers `resync`, and the client re-reads.
- **Checks:**
  - a `ServerPushTag` contract suite, run against the in-memory adapter and the
    SSE adapter, asserting on a fake clock a heartbeat every `PUSH_HEARTBEAT`,
    `reauth` before `exp`, no frame after close, distinct `retry:` values, a
    drain on scope close, and an audience-less envelope reaching nobody;
  - a `PushChannel` contract suite, asserting that three topics construct
    exactly one `EventSource`, that a fourth reopens it once with
    `Last-Event-ID`, and that `reauth` calls `refresh()` before the reopen.
