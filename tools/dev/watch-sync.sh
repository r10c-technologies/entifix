#!/usr/bin/env bash
# Keep a consumer's installed @entifix/* in step with this checkout while you work.
#
#   ENTIFIX_CONSUMERS=$PWD/../r10c pnpm nx run @entifix/source:dev-sync
#
# Builds every publishable package once and syncs all of them, so the consumer
# starts current, then rebuilds and re-syncs each package as it changes. The copy
# itself is `src/main.ts`; README → "Developing against a consumer" is the
# workflow, including how to put the release back.
#
# The selector is `tag:tier:*`, which only published packages carry. Do NOT write
# it as `'*'`: that also matches the workspace root project, whose root is `''`,
# so every file outside another project would attribute to it and fire the
# watcher — and the tools projects have no build to run.
#
# `--excludeTaskDependencies` because rebuilding a package's dependencies is both
# wasted work and a hazard. Their `dist` is already current from the first build,
# and a dependency you edited gets its own spawn. Saving two packages at once
# spawns two nested `nx` processes sharing `NX_INVOCATION_ROOT_PID`; with `^build`
# pulled in, both can register one shared dependency's `build` task, which Nx
# answers with `Recursive task invocation detected` and a package left stale.
# `--skipSync` keeps a background process from rewriting tsconfig references.
#
# `$NX_PROJECT_NAME` MUST stay unexpanded: `nx watch` looks for that literal in
# the command string and substitutes the changed project per spawn. Hence the
# single quotes, and hence a script rather than an inline `nx:run-commands`
# string, which the outer shell would expand first, into nothing.
#
# `nx watch` needs the Nx daemon, so never `NX_DAEMON=false` for this.
#
# The target is deliberately not `continuous`: Nx reports a continuous task as
# successful whatever it exits with, so a sync that failed on its first pass
# read green.
set -euo pipefail

cd "$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

if [[ -z "${ENTIFIX_CONSUMERS:-}" ]]; then
  echo 'dev-sync: set ENTIFIX_CONSUMERS to the repositories to sync into, e.g. ENTIFIX_CONSUMERS=$PWD/../r10c' >&2
  exit 1
fi

pnpm exec nx run-many -t build -p 'tag:tier:*' --skipSync
node tools/dev/src/main.ts

exec pnpm exec nx watch --projects 'tag:tier:*' -- \
  'pnpm exec nx run-many -t build -p $NX_PROJECT_NAME --excludeTaskDependencies --skipSync && node tools/dev/src/main.ts $NX_PROJECT_NAME'
