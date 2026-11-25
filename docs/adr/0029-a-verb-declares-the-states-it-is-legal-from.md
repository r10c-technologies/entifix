# 29. A verb declares the states it is legal from, and a surface hides the rest

- Status: Accepted
- Date: 2026-11-13
- Revised: 2026-11-24 by [#327](https://github.com/r10c-technologies/entifix/issues/327) — Save and Delete take the same declaration (§6), the service refuses from it (§7), and §4 says where presentation ends.
- Area: ui
- Read when: a record's form offers a Save its service always refuses, a released or closed record still renders editable inputs, a hand-written status check refuses an update or a delete, a record's form offers every verb whatever its status, a button that applies to one status sits beside three that apply to others, a verb the record has moved past is still clickable, focus falls to `<body>` after a verb runs, or about to disable a button with a tooltip explaining why it does not apply

## Context

A `@useCase()` descriptor says where a verb appears, how much weight it
carries and how it is made safe ([ADR 0026](0026-actions-hierarchy-overflow-and-destructive-verbs.md)).
It says nothing about **when** it applies. Every surface therefore offers every
declared verb on every record, and the only signal that one does not apply is
the refusal that comes back after it is pressed.

That is tolerable for verbs that apply to any record. It is not for a record
with a lifecycle. A shipment awaiting dispatch, one dispatched and one refused
each take exactly one or two of four moves, and a form showing all four at equal
weight on each of them makes the one that applies hard to find — measured on a
consumer's dispatch screen, where the audit filed it as a heuristic failure. The
refusal message can list the legal moves, but that teaches the reader after the
fact what the screen could have shown before it.

The framework has no notion of a state machine, and should not acquire one to
answer this: a host keeps its transition table wherever its domain keeps it, and
what a surface needs is only the answer for one verb.

## Decision

**1. A verb may declare `availableWhen: { member, in }`.** `member` names an
`enumValues` accessor by its own name — the property the record holds, not a
wire alias — and `in` lists the states the verb applies to. It is copied onto
the served `UseCaseDescriptor` like every other presentation field.

**2. It is checked where it is declared.** A member that is not an enum
accessor of the entity, an empty `in`, a state the member does not hold, or
`availableWhen` on a verb with no record-bound cell — `unbound`, or over a
selection alone — throws at load, naming the verb. A
misspelt state would otherwise hide the verb on every record, which reads as a
missing grant rather than a typo.

**3. A surface about one record hides a verb the record's state does not
allow.** `isUseCaseAvailable(descriptor, record)` in core answers it, and
`availableUseCases` in the controls applies it to a form's header and footer
and to each row's menu. A record still in flight offers none of its
state-bound verbs, rather than all of them for a moment.

Hidden, not disabled. A disabled button with a reason is the right answer for
a verb that _would_ apply if the reader did something first — filled a field,
picked a row. A verb the record has moved past is not one of those: nothing on
this screen makes it apply, and a disabled control is still a stop in the tab
order and a line a screen reader reads out.

**4. What a surface hides is presentation, never authorization.** A record
can change between render and click, so hiding a verb protects nothing; what
refuses is the service (§7) and the verb's handler, whose own conditional
write is still what makes a race lose. A selection carries no states, so the
bulk bar and the toolbar offer every verb, and a row the handler refuses comes
back as a failed `BulkOutcome`.

**5. Focus never falls to `<body>` because a verb left.** Running a verb
usually moves the record out of the states that verb applies to, so the button
the reader pressed unmounts. `useFocusOnLoss` moves a dropped focus to the
form's heading, and in a table to the first visible control in that record's
row or card — only when the element that last held focus has left the
document, so a live update elsewhere never pulls focus around — only after the reader acted, by the same rule as
`useFocusOnArrival` ([ADR 0028](0028-states-an-organism-must-render.md)).

**6. Save and Delete take the same declaration.** They are not `@useCase()`
verbs — every entity has them, as routes the shell derives — so the states
are declared on the entity: `@entity({ writableWhen, deletableWhen,
readOnlyReasonKey })`, each `{ member, in }` and checked at load by the same
rule as §2. A `writableWhen` without a `readOnlyReasonKey` throws: a form that
quietly stops taking input reads as broken. `$metadata` serves all three beside
`actions`. A stored record outside `writableWhen` renders read-only —
`isRecordWritable` in core answers it — with no Save, no View/Edit toggle and
one `role="status"` line saying why; its footer stays, so the verbs its state
does allow (a New version) and Duplicate remain. Outside `deletableWhen`,
Delete is hidden the same way. A create holds no state and is never frozen.
And a verb that answers a **different** record — a New version is a new
record — opens it, so the person lands on the one they can edit rather than
the frozen one they pressed it on.

**7. The service refuses from the declaration, in the write itself.** The
repository port takes `{ expect: { member, in } }` on `save` and `delete`, and
every adapter conjoins it onto the one conditional statement that writes —
beside the revision of
[ADR 0032](0032-a-save-names-the-revision-it-read.md) when there is one —
answering `UnavailableInState` (`409 unavailableInState`, naming the member,
the state and the allowed ones) when the record is in another. A save with
`expect` never creates. The derived update and delete pass the entity's
declaration; an update or delete a host overrides, and a record-bound verb a
person reaches, are checked against the stored record before the handler runs.
A **crossing** verb is not: it is a flow's step, replayed by redelivery, and a
compensation that finds its work already done answers so rather than being
refused. One declaration therefore drives the form, the table, `$metadata` and
the refusal, and the hand-written status check it replaces goes.

## Consequences

- A host with a transition table derives `in` from it, so the states are
  written once and the descriptor cannot drift from the store's own
  conditional write.
- Adding the field is additive: a descriptor without it is offered everywhere,
  as before.
- Rows and cards carry `data-record-id`, scoped by the table's own id, so focus
  can find a record's controls without reaching into a second table.
- A host's hand-written "released, so refused" check is replaced by the
  declaration, and its failure code by `unavailableInState`; a client that keyed
  copy on the old code needs the new one in its `errors` catalog.
- A verb whose availability depends on more than one member, or on something
  other than an enum, is not expressible. None has been needed; the handler's
  refusal remains the answer for those.
