# @entifix/next-shell

The Next.js application shell. `makeEntityCrud` derives the list, detail and edit screens for an entity from its metadata; `BackOfficeShell` and `WorkspaceShell` provide the chrome, sidebar navigation, breadcrumbs, workspace tabs and command palette around them. Drafts and pending writes persist in IndexedDB.

`makeEntityCrud` takes a `delete` policy (`confirm`, `undo` or `typed`) and a `facets` adapter, announces saves and deletions, names a record in its rows, toasts and breadcrumb rather than by its id, and keeps focus on a heading after every write. `ConfirmAction` asks before a Server Action acts, with or without JavaScript; the action guards itself with `whenConfirmed`. `AccountMenu` offers theme and density.

The `server` entry holds the route handlers a Next backend needs: a same-origin proxy to your services, session refresh and cookies, health, and record search across services — and `whenConfirmed` and `readThemeCookies`.

## Names, not ids

A member that holds another entity's id declares `@accessor({ references: { entity: 'domain:key' } })`, and an entity declares the member it is called by with `@entity({ labelMember })`. The host mounts `ReferenceLabelsHost` once, beside its other providers, with one registration per target entity:

```tsx
const REFERENCE_LABELS: ReferenceLabelRegistration[] = [
  [Customer, adapters.customers],
  [Invoice, adapters.invoices, { labelProperty: 'number' }],
];

<ReferenceLabelsHost registrations={REFERENCE_LABELS}>{children}</ReferenceLabelsHost>;
```

Every screen then shows the target's name where it would have shown the key, read in one request per target entity per page and cached per id, so a record's page reuses what its list read. A target's `id` must be `filterable`. An entity no registration reads shows its raw id, muted, and `onUnregistered` is told its key once, for the host to warn about in development.

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
