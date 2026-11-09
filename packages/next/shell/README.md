# @entifix/next-shell

The Next.js application shell. `makeEntityCrud` derives the list, detail and edit screens for an entity from its metadata; `BackOfficeShell` and `WorkspaceShell` provide the chrome, sidebar navigation, breadcrumbs, workspace tabs and command palette around them. Drafts and pending writes persist in IndexedDB.

`makeEntityCrud` takes a `delete` policy (`confirm`, `undo` or `typed`) and a `facets` adapter, announces saves and deletions, names a link column's target and a record's breadcrumb rather than its id, and keeps focus on a heading after every write. `ConfirmAction` asks before a Server Action acts, with or without JavaScript; the action guards itself with `whenConfirmed`. `AccountMenu` offers theme and density.

The `server` entry holds the route handlers a Next backend needs: a same-origin proxy to your services, session refresh and cookies, health, and record search across services — and `whenConfirmed` and `readThemeCookies`.

## Install

```sh
pnpm add @entifix/next-shell @tanstack/react-query effect next react react-dom zustand
```

## Entry points

| Import                       | What it holds                                                                                                                                                |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `@entifix/next-shell`        | Client shell: `makeEntityCrud`, `BackOfficeShell`, `WorkspaceShell`, `ConfirmAction`, `AccountMenu`, `useBreadcrumbLabel`, tabs, drafts, `shellCatalogs`     |
| `@entifix/next-shell/server` | `createServiceProxyRoute`, `createRefreshRoute`, `applySessionCookies`, `createHealthRoutes`, `createRecordSearchRoute`, `whenConfirmed`, `readThemeCookies` |

## Optional peers

Install these only if you use what needs them.

| Peer      | Needed by                           |
| --------- | ----------------------------------- |
| `i18next` | translation through `@entifix/i18n` |

---

Tier 4 (app framework) of entifix — a package depends only on its own tier or below. See [the tiers](https://github.com/r10c-technologies/entifix#the-tiers-and-what-you-are-allowed-to-install). MIT licensed.
