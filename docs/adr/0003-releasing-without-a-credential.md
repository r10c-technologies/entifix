# 3. Releasing without a credential, and the version a commit is allowed to cut

- Status: Accepted
- Date: 2026-09-16
- Revised: 2026-09-16 by [#2](https://github.com/r10c-technologies/entifix/issues/2) — a release pull request superseded by a new version is closed
- Area: platform
- Read when: cutting a release, wondering why the release workflow cannot be renamed, or why a merge did not publish anything — the version is derived from commit messages and nothing in this repository can publish to npm

## Context

`0.1.0` was published on 2026-09-16 and immediately demonstrated the problem this
record exists to fix. Three places record a version — the git tag, the GitHub
Release, and npm — and after exactly one release only two of them agreed: `v0.1.0`
was tagged and written into `CHANGELOG.md`, and no GitHub Release existed at all.

Nothing had gone wrong. Nothing had been asked to create one. The release was
three commands run by hand, each of which happened to cover a different subset of
the three records, and the subset that nobody ran left no trace.

The first release also spent a credential it should not have needed. npm refuses
to configure a trusted publisher for a package that does not exist yet —
`npm trust github --allow-publish` grants a `createPackage` permission, which
reads as though it covers the case and does not; the endpoint answers `404`. So
23 packages were bootstrapped by hand before the trust configuration could be
written. That is a one-time cost and it is now paid.

## Decision

**Nothing in this repository can publish to npm.** There is no `NPM_TOKEN`, no
secret, and no account credential in CI. `permissions: id-token: write` is the
entire publish path: npm exchanges that OIDC token for a short-lived,
package-scoped registry token, and signs the provenance attestation that
`.npmrc`'s `provenance=true` requires. The authority to publish `@entifix/*`
belongs to one workflow file on one repository, and to nothing else.

⚠️ **`.github/workflows/release.yml` cannot be renamed.** The trusted publisher
claim on all 23 packages names that file. Renaming it revokes this workflow's
ability to publish — silently, with no error until a release fails — and every
package has to be re-trusted one at a time, each behind a 2FA prompt.

**A release is a pull request.** Every push to `main` asks what version the
commits since the last release would produce; when that differs from what is
released, a workflow opens a pull request carrying the bumped manifests and the
changelog. Merging it is what releases. The version is therefore always read as a
diff by a human before anything reaches a registry that does not allow a version
to be taken back after 72 hours.

⚠️ That pull request is opened with a **GitHub App token, not `GITHUB_TOKEN`**. A
pull request opened with the built-in token does not trigger `pull_request`
workflows, so the release pull request would never run the check that `main`
requires and could never be merged. The app can write to this repository and
nothing else; it cannot publish.

⚠️ **The branch is named for the version, so a version change opens a second pull
request.** A `feat:` landing while `release/v0.1.2` is open proposes
`release/v0.2.0` beside it, and the older one is never rebuilt again — merging it
would tag and publish the current `main` under the number it was opened for. The
workflow therefore closes every other open `release/v*` pull request, and deletes
its branch, whenever it opens or updates one, with a comment naming the
replacement. It looks up only **open** pull requests for the current branch, so a
version asked for a second time opens a fresh one rather than editing the closed
one.

**Publishing waits for a person.** The publish job declares the `npm-publish`
environment, which holds it until a reviewer approves, and the npm trust claim
names the same environment — so a job that did not declare it cannot mint a
publish-capable token even if this file were edited. Provenance proves which
workflow published a tarball; it proves nothing about what is in it, and a
compromised runner holding a legitimately scoped OIDC token is a documented 2026
supply-chain attack rather than a hypothetical one.

**The tag, the npm version and the GitHub Release are three steps of one job**,
in that order. The order follows the asymmetry: npm is the only irreversible
step. A tag with no package behind it is a `git push --delete` away from gone,
while a GitHub Release announcing a version npm never received is a lie that
consumers read.

**A commit may not cut a major version.** ADR 0001 fixes the channels while the
framework is pre-1.0: a breaking change rides the minor, `0.1.x` is the patch
channel and `0.2.0` is the breaking channel. Nx's
`adjustSemverBumpsForZeroMajorVersion` implements exactly that and is its
default; `nx.json` states it anyway, because a default a future version could
flip is a poor place to keep a rule a record depends on.

**Commit conventions are checked in CI, not only by a hook.** `.husky/commit-msg`
runs on one machine and is skipped by `--no-verify`, by a clone where
`pnpm install` never ran, and by the GitHub web editor. Since the version is
inferred from these messages, a message that evades the hook does not merely look
untidy — it changes which version ships. A separate `Commit conventions` job
lints every commit in the pull request's range, the pull request title (which
becomes the commit message under a squash merge, and is therefore the text
inference reads), and the pull request body for attribution, which is the one
surface no git hook can see.

## Consequences

⚠️ **Prose in a commit body can change the released version.** The conventional
commits parser reads `BREAKING CHANGE:` anywhere in a message as a real footer,
including inside a sentence that merely discusses one. A commit written to
_explain_ the 0.x channel rule resolved the release to `major` and would have cut
`0.2.0`. Discuss the marker without writing it — the rehearsal caught this, and
nothing else would have.

**Two loop guards, and the obvious one is wrong.** Merging a release pull request
pushes to `main`, which re-runs the workflow that opens release pull requests.
The guard is a version comparison — has the inferred version actually moved —
rather than a check on the head commit's message: under a merge commit that
message is `Merge pull request #N…`, and a message check would miss it and open a
second release pull request. Nx independently filters its own release commits out
of inference, which is a second line of defence and not a substitute.

**`nx release` is used as three subcommands, not one command.** `nx release
version` refuses to start while `release.git` is set at the top level, so the git
options live under `release.version.git` and `release.changelog.git`, with
commit, tag and push all false: those steps belong to the workflows and happen
explicitly. `nx release changelog` has no `--create-release` flag — the option
exists only in `nx.json`, where setting it would make the _prepare_ step publish a
GitHub Release for a version that has not shipped. The Release is created with
`gh release create` instead, from the same changelog section the pull request
body was built from, so the two cannot describe different things.

**A release needs a human twice**: once to merge the release pull request, once
to approve the environment. That is the intended cost. The alternative is a merge
that reaches npm unattended, and an npm version cannot be unpublished after 72
hours.

**The bootstrap prereleases stay.** The `0.1.0-0` versions published by hand to
create the package names remain on the `bootstrap` dist-tag. Nothing resolves to
them, and removing them is a separate decision with its own 72-hour clock.
