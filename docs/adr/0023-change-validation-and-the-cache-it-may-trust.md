# 23. Change Validation, and what may trust the cache it carries

- Status: Accepted
- Date: 2026-11-05
- Area: platform
- Read when: a CI job is slow because it rebuilds what another job built, adding a job or a check to `change_validation.yml`, a check passed without running, the Actions cache is near its 10 GB, or about to restore `.nx/cache` between runners — a restored `.nx/cache` is ignored by Nx 24, and a repository-wide assertion must never read from the cache

## Context

The pull-request check ran every job on an empty Nx cache. Nothing a build
produced reached another job, so each build chunk rebuilt every library it
depended on, and the e2e job rebuilt the example application it was about to
test. The workflow also ran on pushes to `main` and by hand, so its name,
"Pull Request Check", described one of its three triggers.

Each run's `actions/cache` entries were scoped to the pull request that wrote
them. A cache is readable from its own ref and from `main`, and the pnpm store
cache was saved per pull request although every job then restored
`node_modules` itself. The repository sat at its 10 GB limit with entries no
other run could read, and GitHub evicts the oldest entry first, which is
`main`'s.

And the release workflow re-ran the whole gate serially, about eight and a
half minutes, on the commit `main`'s own run was validating at the same moment.
Branch protection is strict, so that tree is the one the release pull request
already passed.

Sharing the cache with a hosted service was ruled out: the cache stays in
GitHub, and nothing else holds the framework's build output.

## Decision

### The cache travels as entries addressed by hash, served by a loopback server

Nx 24 replays only cache entries indexed in its database, a SQLite file named
after the machine (`.nx/workspace-data/<machine-id>-v6.db`). Every runner is a
new machine, so a restored `.nx/cache` is ignored as "unrecognized artifacts",
and `NX_REJECT_UNKNOWN_LOCAL_CACHE=0`, which used to override that, is not
supported by the database cache. Copying that database is not enough either:
several jobs' databases cannot be merged by copying files.

Nx also ships a client for a self-hosted HTTP cache, which needs no index. So
every job that uses the cache starts `tools/ci/nx-remote-cache.mjs` on
`127.0.0.1` behind a token minted for that job, over `.nx-remote/entries`. An
entry is a file named by its task hash, so the entries of several jobs merge
by copying. That directory is what `actions/cache` carries between runs and
what artifacts carry between the jobs of one run.

### `main` warms the cache; a pull request also keeps its own

The run on `main` saves the cache, and a pull request without an entry of its
own starts from it. A pull request also saves into its own scope, so its next
push starts from its last run rather than from `main`'s. The save prunes to the
entries some job of the run read or wrote, which keeps a cache restored and
saved run after run from growing without bound. One entry is kept per ref,
`cache_cleanup.yml` deletes a pull request's caches when it closes, and
`node_modules` and the Playwright browser are saved from `main` only.

### What never reads the cache

A replayed result is only as true as the task's inputs are complete. Three
kinds of job therefore skip the cache:

- **The repository assertions** (`@entifix/tiers`, `@entifix/docs-check`). They
  read the whole tree, while their hash covers their own project. A pull
  request that breaks a tier claim usually adds a dependency to one package,
  which would not change their hash.
- **The workflow engine's chaos suite.** It exists to be run against the timing
  of the moment, and a replayed pass would prove only that it once passed.
- **Publishing.** `release.yml`'s publish job installs and builds from source
  on a fresh runner, and nothing restores a cache into it.

### Libraries once, applications fan out

`Build libraries` builds and typechecks every affected library on one runner.
`Build (<app>)` runs one job per affected application and reads the libraries
from the cache. `E2E services` runs the suites that need no browser alongside
everything else. `E2E browser (<app>)` runs one Playwright suite per job and
reads its application's build from the cache. Lint and test do not wait for
the build, since neither reads a `dist`.

### The release waits for `main`'s run

`release.yml`'s `verify` job waits for the Change Validation run for the merged
commit, and fails when that run fails or is cancelled. On `main` that run
validates the whole graph and is never cancelled. The file's name, its trigger,
the `npm-publish` environment and the publish job are unchanged
([ADR 0003](0003-releasing-without-a-credential.md)).

## Consequences

- A pull request that changes `.github/` or `tools/ci/` runs the whole graph.
  Such a change affects no project, so affected-only would prove the new
  pipeline on nothing.
- A cache that fails to save costs the next run time, never this run its
  result: `Save the Nx cache` is not in `Done`'s `needs`.
- A job that cannot reach its server fails, and so does a server answering the
  wrong token: Nx's client refuses the endpoint rather than building around it.
- `release.yml` names `change_validation.yml`. Renaming the validation workflow
  means editing that line, or every release waits for a run that never comes.
- A flaky failure on `main` blocks the release until that run is re-run; the
  release is then re-run by hand, the path `workflow_dispatch` already keeps.
