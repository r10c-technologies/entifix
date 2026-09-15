# Architecture Decision Records

Short records of significant architectural decisions — the context, the decision,
and its consequences. One file per decision, numbered.

**An ADR's reasoning is immutable; its factual claims are not.** A statement
about how the framework is arranged is corrected in place when it stops being
true. A _decision_ that no longer holds is still superseded by a new record,
never edited away.

Format: [Michael Nygard's ADR template](https://github.com/joelparkerhenderson/architecture-decision-record).

## This collection starts at 0001, and the older records are elsewhere

entifix was extracted from `r10c-technologies/r10c`, which holds 59 records of
its own. They stayed there: they are one connected body, supersessions run
across them, and the reasoning behind a shell is inseparable from the
application it was drawn for.

entifix source still cites those records, and the appendix of
[ADR 0001](0001-the-tier-contract-and-the-host-seam.md) maps every cited number
to a one-line summary — so a reader who meets `ADR 0030` in a source comment is
not stranded when that repository turns private. A citation is rewritten to a
record in _this_ collection by the record that replaces what it pointed at,
rather than in a batch.

## Status lifecycle

**Proposed → Accepted → Superseded.**

- **Accepted** — in effect. The code follows it; a change that contradicts it
  needs a superseding record, not a pull-request comment.
- **Proposed** — decided in full but not yet implemented. A Proposed record
  carries a `## Trigger` section naming what promotes it, so the iteration that
  finally needs the decision inherits the reasoning instead of re-deriving it.
- **Superseded** — replaced. Kept, never deleted, with a link forward.

## Every record carries two headers, and the build checks them

```
- Area: entities | adapters | ui | platform | testing
- Read when: <the symptom that should send a reader here>
```

`- Read when:` names the **symptom**, not the subject. A line naming the subject
gets skipped; one naming the symptom gets read, and that is the whole difference
between an index and a digest. `pnpm nx test @entifix/docs-check` fails on a
record missing either header, or filed under an area that is not in the list.

## Correcting a record

Three tiers. The first two edit in place; only the third uses a new record.

- **Fix** — the record asserts something about the code that is now false.
  Correct it where it stands.
- **Clarify** — the reasoning holds and the wording now misleads. Rewrite in
  place, usually as a dated blockquote beside the original so the change is
  visible rather than silent.
- **Supersede** — the _decision_ no longer holds. A new record, with a
  blockquote in the old one pointing forward and its text kept.

An **Accepted** record gains a header line when it is edited in place —

```
- Revised: <date> by [ADR 00XX](00XX-….md) — <what changed, in one clause>
```

— so `grep -n "Revised:" docs/adr/0*.md` lists every in-place edit ever made.

**Supersession is symmetric**, and it is the rule most easily missed: a record
claiming to supersede another must leave the reciprocal line _on the record it
overrode_. Writing it only forward means a reader who opens the old record sees
`Status: Accepted` and no marker. `@entifix/docs-check` fails the build on a
one-way claim.

## The records

- [0001](0001-the-tier-contract-and-the-host-seam.md) — **The tier contract, and the seam a host configures across.** Read when adding a package, adding a dependency between two, deciding whether something is public API, or about to bake a host's value into framework code.
- [0002](0002-entifix-is-mit.md) — **entifix is MIT, and the trigger that would freeze that choice.** Read when publishing a package, accepting an outside contribution, or wondering whether the licence can still be changed.
