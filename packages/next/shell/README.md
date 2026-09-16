# @entifix/next-shell

The Next.js application shell. `makeEntityCrud` derives the list, detail and edit screens for an entity from its metadata; `BackOfficeShell` and `WorkspaceShell` provide the chrome, sidebar navigation, breadcrumbs, workspace tabs and command palette around them. Drafts and pending writes persist in IndexedDB.

The `server` entry holds the route handlers a Next backend needs: a same-origin proxy to your services, session refresh and cookies, health, and record search across services.

## Install

```sh
pnpm add @entifix/next-shell @tanstack/react-query effect next react react-dom zustand
```

## Entry points

| Import                       | What it holds                                                                                                           |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `@entifix/next-shell`        | Client shell: `makeEntityCrud`, `BackOfficeShell`, `WorkspaceShell`, tabs, drafts, `shellCatalogs`                      |
| `@entifix/next-shell/server` | `createServiceProxyRoute`, `createRefreshRoute`, `applySessionCookies`, `createHealthRoutes`, `createRecordSearchRoute` |

## Optional peers

Install these only if you use what needs them.

| Peer      | Needed by                           |
| --------- | ----------------------------------- |
| `i18next` | translation through `@entifix/i18n` |

---

Tier 4 (app framework) of entifix — a package depends only on its own tier or below. See [the tiers](https://github.com/r10c-technologies/entifix#the-tiers-and-what-you-are-allowed-to-install). MIT licensed.
