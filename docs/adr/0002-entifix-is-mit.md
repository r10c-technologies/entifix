# 2. entifix is MIT, and the trigger that would freeze that choice

- Status: Accepted
- Date: 2026-09-15
- Area: platform
- Read when: publishing a package, accepting an outside contribution, or wondering whether the licence can still be changed — a shipped version's grant is permanent, the project's licence going forward is not

## Context

Nothing in this code has ever been licensed. It lived in `r10c-technologies/r10c`,
which is public and carries no `LICENSE` file, so default copyright applied and
every right was reserved: a reader could view it and fork it inside GitHub under
GitHub's terms, and do nothing else with it. The root manifest's
`"license": "MIT"` sat under `"private": true` and was therefore a note to
ourselves — never served to a registry, never in a tarball, never an offer to
anyone.

Publishing is the act that changes that, and it is the reason this record exists
now rather than later. `npm publish` turns the string into a public grant, and
⚠️ **the grant on a published version cannot be withdrawn.** Anyone who fetches
`@entifix/core@0.1.0` under a licence keeps that licence for that version
permanently; npm additionally refuses an unpublish after 72 hours once anything
depends on the package.

## Decision

**entifix is MIT.** It is the simplest licence that makes the project open
source, it is what the manifest already claimed, and every external dependency in
the tree is compatible with it — MIT, Apache-2.0, ISC, and `posthog-js`'s
`(Apache-2.0 AND MIT)`. No copyleft anywhere, so nothing upstream constrained the
choice.

The alternative considered was Apache-2.0, and what it would have bought is two
clauses MIT does not have:

- **§3, an express patent grant** from every contributor, terminating if a user
  sues over patents. MIT is silent on patents; a user gets copyright permission
  and infers the rest.
- **§6, an explicit trademark withholding.** Under MIT the name `entifix` is
  protected only by trademark law itself, which we have not invoked.

Both matter more for a framework published by a company than by a person, and
neither is worth the longer file today. What makes that trade cheap is the
section below rather than the clauses themselves.

### The licence is still ours to change — until it is not

A shipped version's grant is permanent, but the project's licence _going forward_
is not. We hold all the copyright in this tree, so relicensing `0.2.0` onward to
Apache-2.0 is ours to do unilaterally at any point.

⚠️ **That ends with the first outside contribution.** A contributor holds
copyright in their patch, and relicensing then needs every one of them to agree,
found and asked individually. So the trigger is not a version number — it is the
first pull request from outside:

> **Before merging an outside contribution, either take a CLA (or a DCO whose
> terms permit relicensing), or accept that MIT is permanent.**

Choosing MIT today is cheap precisely because that door is still open. Leaving it
open is a thing we have to do on purpose.

### The licence ships per package, not per repository

npm packs per package: a `LICENSE` at the repository root does not land in
`@entifix/core`'s tarball. So every published package carries a `license` field
**and** the licence text in its own published files. A package with neither is
rendered by npm as having no licence, which fails an adopter's dependency scanner
and a corporate policy gate before a human ever reads the code.

## Consequences

- **Each of the 23 packages carries `"license": "MIT"` and a `LICENSE`**, and a
  new package that forgets is a package nobody's legal review will clear. This is
  a packing rule, so it belongs with the release configuration.
- **We ship no patent grant.** An adopter whose review requires one will ask for
  Apache-2.0, and the answer is the relicensing path above rather than a dual
  licence.
- **The name is not protected by the licence.** Combined with publishing
  `@entifix/*` out of an org named `r10c-technologies`, the thing that makes the
  provenance legible is the npm provenance attestation, not the licence.
- **r10c's own manifest still claims MIT** while being all-rights-reserved in
  practice, and that repository goes private later. Its claim is that
  repository's problem to settle, and it is now the only place the string is
  wrong.
