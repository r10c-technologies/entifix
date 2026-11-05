# 26. Actions: one primary, an overflow, and a destructive verb that declares how it is undone

- Status: Proposed
- Date: 2026-11-05
- Area: ui
- Read when: adding a verb to an entity, a screen shows a row of equal-weight buttons, a delete or cancel happens in one click, "New" appears where nothing can be created, a toolbar or bulk verb acts on every matching row, a Server Action needs a confirmation without JavaScript, or about to add a keyboard shortcut

## Context

Verbs reach the screen through action surfaces: form header, form footer, row
menu, bulk bar, table toolbar and the command palette. Each is driven by the
`@useCase()` descriptor and its `confirm` metadata. That machinery is sound
where it is used, and it leaves five gaps.

**1. The CRUD triple is not descriptors.**

- Save, Delete and Clone are rendered by hand, by design.
- Delete was never given the confirmation a descriptor would carry. On every
  generated record page it is a `secondary` button between Save and Back.
- It hard-deletes in one click, with no feedback, and drops focus on `<body>`.
  That was measured live on a configuration row the services boot from.

**2. The table toolbar bypasses `invoke()`.**

- A `collection` verb in the table toolbar calls `onBulkUseCase` directly.
- A destructive one would act on every row the filter matches, with no dialog.
- It is latent today only because no such verb is declared.

**3. Three surfaces have three rules for how many verbs show.**

- The form header shows four plus an overflow, counting no primary.
- The bulk bar shows everything.
- The toolbar shows everything.

Nothing says which verb is primary. A list's "New" is a text link. "New" also
renders on every list whether or not the principal may create that entity, or
whether the entity is only ever created by a flow. The user types a whole record
before finding no Save.

**4. A destructive verb has one treatment: a dialog, or nothing.**

- A soft state with a ready inverse (retire/restore, unpublish/publish) gets the
  same dialog as an irreversible refund.
- Frequent confirmations train people to click through them.
- The dialog itself is a `dialog`, not an `alertdialog`. Its message is not
  wired as its description. Its confirm button says "Confirm", not the verb.
  A selection's dialog never says how many records it acts on.

**5. A page served without client JavaScript has no confirm at all.**
Server Actions post a form, and `Button` is a client component.

## Decision

### The descriptor states the hierarchy

`UseCaseDescriptor` gains:

| Field                                             | Meaning                                                                                               |
| ------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `emphasis: 'primary' \| 'default'`                | At most one primary per surface. A second throws at render, as `collection + determining` does today. |
| `priority?: number`                               | Overrides declaration order where needed.                                                             |
| `rowInline?: true`                                | The one verb a row may show inline (a worklist's Dispatch). At most one per entity.                   |
| `shortcut?: string`                               | A modifier chord, rendered as `aria-keyshortcuts` and listed in the palette.                          |
| `reversible: 'undo' \| 'confirm' \| 'typed'`      | Required on a destructive verb (`confirm.tone: 'destructive'`).                                       |
| `inverse?: string`                                | The verb that undoes this one, required when `reversible: 'undo'`.                                    |
| `confirm.confirmLabelKey`, `confirm.count?: true` | The verb as the button label, and the selection size interpolated.                                    |

### One `<ActionBar>` renders every surface

- **One component.** `<ActionBar surface actions>` replaces the per-surface
  limits in EntityForm, EntityTable and BulkActionBar.
- **What shows.**
  - The primary.
  - Up to three secondaries, in declaration and `priority` order.
  - Then a "More actions" menu button: the WAI-ARIA menu button pattern on
    Headless UI, named "Actions for {record}" on a row.
  - Under a container query the bar collapses to the primary plus the menu.
    There is no JavaScript measurement, so server rendering stays correct.
- **Destructive placement.**
  - A destructive verb is **never primary on a page**. It is primary only
    inside its own confirmation.
  - It sits last, after a separator.
  - When it is a main function of its surface it is never folded into the menu.
- **"New" on a list** is a primary button. It renders only when the entity
  declares a create verb **and** the verified principal may create it. An
  entity created only by a flow shows no "New".
- **Every verb goes through `invoke()`** on every surface, the toolbar
  included, so `confirm` and `reversible` cannot be bypassed.
- **Row actions.**
  - The row's title is its link: an `<a>` in the first labelled cell, replacing
    the separate "Open" column.
  - Secondary verbs go in the row's menu.
  - At most one `rowInline` verb is shown, always visible, never on hover
    alone.

### A destructive verb chooses confirm or undo by what it can take back

- **`undo`:** the act runs at once. A `role="status"` toast says what happened
  in the past tense ("Retired 3 brands") with an **Undo** action that invokes
  `inverse`. It is right for soft states and for removing an item from a local
  collection.
- **`confirm`:** an `alertdialog`.
  - Its title is a question naming the object and, for a selection, the count
    ("Retire 3,200 brands?").
  - Its body states the consequence, not "Are you sure?".
  - Its confirm button repeats the verb with the count ("Retire 3,200 brands").
  - Initial focus is on Cancel, and Escape cancels.
  - It is right for anything irreversible or with an effect outside the
    record: a hard delete, a cancellation that refunds, a session revocation.
- **`typed`:** the confirmation also asks for the object's name or the count to
  be typed. It is for a `matching` selection above a host-set threshold
  (default 1,000) and for records a system boots from.
- **`makeEntityCrud`'s Delete takes a `delete` policy.** Its default is
  `confirm`, because it is a hard delete with no inverse. After either path
  focus moves to the list's heading or to the next record, never to `<body>`,
  and the outcome is announced.

### A confirmation that works without JavaScript

`ConfirmAction` wraps a Server Action form for pages that avoid client
boundaries:

- Without JavaScript the form posts to an interstitial step that renders the
  same title, consequence and verb, and posts again to act.
- With JavaScript it is enhanced into a native `<dialog>` with the same copy.
- The Server Action re-checks the confirmation either way. The interstitial
  cannot be skipped by posting directly.

### Keyboard accelerators

- **`useHotkey` becomes a registry.** Shortcuts are modifier chords only.
  - There are no single-key shortcuts, because WCAG 2.1.4 would require a
    switch for them.
  - There is no Alt+letter, because on macOS Option composes characters.
- **Scope.** Shortcuts are scoped to the active workspace tab and suppressed
  inside text inputs, except for chords.
- **Discovery.** The command palette lists every reachable action with its
  shortcut. That is the discovery path.
- **The defaults the shell binds:**

  | Chord     | Action                |
  | --------- | --------------------- |
  | Mod+K     | palette               |
  | Mod+S     | save                  |
  | Mod+Enter | the surface's primary |

  Anything else is a descriptor's `shortcut`.

### Content

Confirmation, undo and empty-action copy are catalog keys under `confirm.*` in
the controls catalog. A host supplies object names through the descriptor's
label keys, never as literals.

## Consequences

- Every declared destructive verb must state `reversible`. Declaring one without
  it fails at module load, which is a breaking change for any host with a
  destructive verb, so it rides the minor.
- A host that rendered a verb by hand beside its declared descriptor loses the
  reason to. The descriptor now carries what the hand version lacked.
- `SplitButton`, whose menu is a navigation disclosure rather than an action
  menu, is rebuilt on `Menu` or deleted. It has no adopter, so it is deleted
  unless one appears in the same change.
- The toolbar fix changes behaviour for any `collection` verb that relied on
  skipping its own confirmation. None is declared in the examples.

## Trigger

Promoted to **Accepted** by the change that lands the descriptor fields,
`<ActionBar>` on all six surfaces, the toolbar through `invoke()`, the
`alertdialog` confirmation, undo through the toast region, `makeEntityCrud`'s
`delete` policy and gated "New", `ConfirmAction`, and the hotkey registry.
