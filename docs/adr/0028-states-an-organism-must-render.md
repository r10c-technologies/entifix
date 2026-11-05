# 28. The states an organism must render, and what each one shows, announces and offers

- Status: Proposed
- Date: 2026-11-05
- Area: ui
- Read when: a list or form shows "Could not load records" with no way forward, an empty list looks the same as a filtered-out one, a save gives no sign it happened, focus lands on `<body>` after a write, a failure toast has no action, live updates stop with nothing on screen, a 403 or a missing organization renders a dead end, or about to write a `<p role="alert">` inside an organism

## Context

Each organism handles its states itself, and the result is uneven:

**Loading is good everywhere.** There is a geometry-matched skeleton,
`aria-busy` and a polite status.

**Everything after loading thins out:**

- **Empty.** EntityTable says "No records" whether the entity has none or a
  filter removed them all. Neither case offers a next step.
- **Errors.** A load failure renders an alert with no Retry, in EntityTable,
  EntityForm and the Wizard alike.
- **Writes.**
  - A save or delete through `makeEntityCrud` shows no confirmation of any
    kind, although a toast region is mounted. Focus lands on `<body>`, which was
    measured live after both.
  - Toasts can only report failures and carry no action.
  - A row verb answering `202` shows nothing while pending.
- **Connection.** The push channel knows when it is disconnected
  ([ADR 0021](0021-server-push-and-the-multiplexed-channel.md)), and nothing on
  screen says so. A pending write then waits with no explanation.
- **Authorization.** A 403 renders a coded message naming no way forward. A
  missing active organization renders "Select an organization to continue"
  with no link to do it.
- **Validation.** A raw catalog key (`validation.required:Name`) can reach the
  screen.
- **The region itself.** An empty toast region still covers the bottom-right
  corner. Live, it covered two focused links and swallowed clicks (2.4.11).

The optimistic contract ([ADR 0022](0022-two-settle-modes-and-the-pending-flow-store.md))
already defines what pending, confirmed and failed _mean_. This record defines
what they _look like_, beside every other state.

## Decision

### One state contract

| State                  | Shows                                                                                                       | Announces                                           | Offers                                              |
| ---------------------- | ----------------------------------------------------------------------------------------------------------- | --------------------------------------------------- | --------------------------------------------------- |
| Loading (first)        | skeleton matched to geometry, `aria-hidden`                                                                 | `status`: "Loading {plural}…", once                 | —                                                   |
| Refetch                | previous data at full contrast; `aria-busy` on the region                                                   | nothing                                             | —                                                   |
| Empty, first use       | one sentence: what appears here                                                                             | in the result-count status                          | the create action, if the principal may             |
| Empty, no results      | "No {plural} match these filters", plus the active chips                                                    | `status`: "No results"                              | **Clear filters**                                   |
| Load error             | inline `Alert tone="danger"` at the region; stale data kept and marked possibly out of date                 | `alert`, once                                       | **Retry**                                           |
| Partial                | counts for both halves, a reason per item                                                                   | `alert` if any failed, else `status`                | **Retry failed**                                    |
| Pending (`202`)        | the control reads "Pending…"; the row or record carries a pending badge; the form stays mounted             | `status`: "Sent — waiting for confirmation"         | keep working                                        |
| Confirmed              | the updated record; a toast only if the user has left the context                                           | `status`                                            | a link to the record                                |
| Failed                 | a toast that stays until dismissed, plus an inline marker if the record is still on screen; input preserved | `alert`                                             | **Retry** (same idempotency key) or **Open record** |
| Rolled back            | the reverted value, briefly highlighted                                                                     | `alert`: "Couldn't publish 'X'; it's back to draft" | **Retry**                                           |
| Connection lost        | TopBar: "Live updates paused — reconnecting"; pending badges read "Waiting for connection"                  | `status` on loss and on recovery only               | **Reconnect now**                                   |
| Forbidden (403)        | "You don't have permission to {verb} {entity}."                                                             | `alert`                                             | who can grant it, if the host supplies it           |
| No active organization | "Choose an organization to see {plural}."                                                                   | `alert`                                             | **Choose organization**                             |

**After any write, focus moves somewhere meaningful:**

- the record's heading after a save;
- the list's heading, or the next record, after a delete;
- the first invalid field's summary after a refused save.

It never lands on `<body>`. EntityForm's errors become programmatic as part of
this:

- a real `<form>`, so Enter submits;
- `aria-invalid` and `aria-describedby` on each field;
- required fields marked before submission;
- an error summary that takes focus;
- `<dl>` semantics in read mode instead of labels pointing at nothing.

EntityDetailGrid already does the field half and is the reference.

### The mechanism

- **`<RegionState>`** takes `{ isLoading, error, isEmpty, isFiltered, onRetry,
emptyAction }`. EntityTable, EntityForm, EntityDetailGrid and Wizard render
  their states through it, and a host's own screen can too. It is built on two
  new molecules, `Alert` (`role` decided by tone: `alert` for danger, `status`
  otherwise, never both) and `EmptyState`.
- **The toast API becomes `show({ tone, message, action? })`.**
  - Success, undo and info are `status`. Failure is `alert` and persists until
    dismissed.
  - An empty region occupies no space and takes no pointer events.
  - Toasts sit on the `--z-toast` layer, with scroll padding so a focused
    control is never under one.
  - F6 moves focus into the region.
  - `makeEntityCrud` announces every save and delete through it.
- **`usePushConnection()`** in `@entifix/react-integration` exposes the push
  channel's state, `open | reconnecting | closed`. TopBar takes it as a
  `connection` prop, which next-shell passes in: `react-controls` never imports
  `react-integration`.
- **An error's next step is catalog copy plus a host handler.**
  - Beside `errors:<code>`, a catalog may carry `errors:<code>Action` (for
    example "Choose organization").
  - The host registers an `ErrorActions` map from code to handler.
  - The organism renders the button only when both exist.
  - The code stays the catalog key, and a host's catalog check should refuse an
    `…Action` key without its code.
- **Validation messages resolve through the catalog before they reach the
  screen.** A key with interpolation (`validation.required:Name`) is a defect,
  and the form's spec asserts against it.

### Content

- Errors say what happened and what to do, name the object, and never blame
  the user. No "Error:" or "Oops", and never a code or an id.
- An empty state is one sentence and one action.
- Copy lives under `state.*` and `errors.*` in the controls catalog, with every
  locale filled.

## Consequences

- Every organism loses its private alert and empty markup in favour of one
  component. A host that styled those private elements has nothing left to
  style, and styles `Alert` and `EmptyState` instead.
- Success toasts are new. A CRUD save that leaves the page announces through the
  region rather than in silence, which hosts will hear in their e2e journeys.
- `<form>` around EntityForm makes Enter submit. Any host that relied on Enter
  doing nothing in a text field now gets a submit, which is the platform
  default.

## Trigger

Promoted to **Accepted** by the change that lands `<RegionState>`, `Alert`,
`EmptyState`, the general toast API, `usePushConnection` with the TopBar
indicator, the error action key, focus placement after writes, and EntityForm's
programmatic errors — with a story per state per organism under the gate of
[ADR 0024](0024-wcag-2-2-aa-and-the-gates-that-ratchet-to-it.md).
