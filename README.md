# entifix

An entity framework for TypeScript: you describe an entity once, and the same
description drives the repository that stores it, the route that serves it, the
table that lists it and the form that edits it.

It ships the entity system **and** the shells that serve and render it. A
framework that describes entities but leaves you to write the route has handed
over the smaller half.

> **Status — `0.1.0`, and honest about it.** entifix was extracted from a
> marketplace that had been driving it for a year, so the code is exercised; what
> is new is the packaging. The API is `0.x`: breaking changes ride the minor, so
> `0.1.x` is patches and `0.2.0` is the breaking channel.

## The first thing you have to write

⚠️ **Every adopter writes the i18n type augmentation, before anything renders.**
TypeScript permits exactly one `declare module 'i18next'` per compilation, so the
framework cannot ship it — a second declaration is `TS2717`. Each package owns
its own catalogs and namespaces; what you compose is the _type_ gate:

```ts
// src/i18n.ts — one module in your application, imported by every entry point
import { defineCatalogs } from '@entifix/i18n';
import { shellCatalogs, type ShellResources } from '@entifix/next-shell';
import { controlsCatalogs, type ControlsResources } from '@entifix/react-controls';

import { appCatalogs, type AppResources } from './catalogs';

// The one typed-key shape, composed here because only a host can compose it.
export type Resources = ControlsResources & ShellResources & AppResources;

// Load-bearing though it imports nothing: a `declare module` resolves from this
// file's directory, so `i18next` must be a dependency of your application.
import type {} from 'i18next';

declare module 'i18next' {
  interface CustomTypeOptions {
    defaultNS: 'app';
    resources: Resources;
  }
}

defineCatalogs({
  resources: {
    es: { ...controlsCatalogs.es, ...shellCatalogs.es, ...appCatalogs.es },
    en: { ...controlsCatalogs.en, ...shellCatalogs.en, ...appCatalogs.en },
  },
  namespaces: ['controls', 'shell', 'app'],
  defaultNS: 'app',
});
```

Each package ships the copy for what _it_ renders — `controls` with the agnostic
entity UI, `shell` with the chrome — and exports both the catalogs and their
type. Your own namespaces merge in beside them. Binding `CustomTypeOptions` to
that shape is what makes `t('controls:table.acions')` a compile error rather
than a blank string at runtime.

⚠️ **Install it once per bundle, not once per application.** A Next app's server
and client are separate bundles with separate module state: call it from your
root layout _and_ from your client provider. Installing only from the provider
leaves every server render throwing `No i18n catalogs are installed`, and no unit
test can see it.

## The tiers, and what you are allowed to install

Six tiers. A package depends only on its own tier or below, and — the rule that
actually matters — never hard-depends on a capability its tier is supposed to be
adoptable without.

| Tier |               | Packages                                                                                              |
| ---- | ------------- | ----------------------------------------------------------------------------------------------------- |
| T0   | standalone    | `style` · `tooling`                                                                                   |
| T1   | entity        | `core` · `business`                                                                                   |
| T2   | adapters      | `mongo` · `sql` · `redis` · `amqp` · `rest` · `transactions` · `jwt` · `zitadel` · `posthog` · `i18n` |
| T3   | ui            | `react-controls` · `react-integration`                                                                |
| T4   | app framework | `authz` · `service-shell` · `next-shell` · `next-i18n`                                                |
| T5   | testing       | `testing-unit` · `testing-e2e` · `testing-auth`                                                       |

So a table does not arrive with i18next and a Spanish catalog attached, and a
Mongo repository does not arrive with a saga engine. Where a package _can_ use an
optional capability, it is an optional peer reached through a subpath —
`@entifix/react-controls/i18next`, `@entifix/mongo/transactions`.

The reasoning, and the invariant that fails the build, is
[ADR 0001](docs/adr/0001-the-tier-contract-and-the-host-seam.md).

## What a host supplies

entifix reads no file and knows no file format. Four things cross the seam, all
of them **values** rather than paths: your catalogs, your grant table, the Layers
that verify a real token, and your own copy. TypeScript by default — a
`Record<Role, readonly Permission[]>` makes a typo a compile error — with JSON
accepted through Standard Schema for a host that must configure at runtime.

## Three packages ship unexercised

`@entifix/zitadel`, `@entifix/jwt` and `@entifix/posthog` are vendor adapters with
unit tests and no example. They are published because the framework's own shells
use their ports, not because their integrations are demonstrated here.

## Working on entifix

```sh
pnpm install
pnpm nx run-many -t build          # every package
pnpm nx run-many -t typecheck      # the declaration pass, separately
pnpm nx run-many -t test           # unit tests; packages/* are gated at 100%
pnpm nx run-many -t lint
pnpm nx test @entifix/tiers        # the tier contract, against the tree
pnpm nx test @entifix/docs-check   # links, record headers, supersession
```

## Licence

MIT — see [LICENSE](LICENSE), and
[ADR 0002](docs/adr/0002-entifix-is-mit.md) for what that chose and what it left
open.
