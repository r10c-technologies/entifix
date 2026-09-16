# @entifix/i18n

The i18next binding. Every entifix package that renders copy ships its own catalogs; an application installs them once with `defineCatalogs` and composes the typed-key shape that makes a mistyped key a compile error.

See [the first thing you have to write](https://github.com/r10c-technologies/entifix#the-first-thing-you-have-to-write) — the type augmentation only an application can declare.

## Install

```sh
pnpm add @entifix/i18n i18next
```

## Entry points

| Import                  | What it holds                                                                                    |
| ----------------------- | ------------------------------------------------------------------------------------------------ |
| `@entifix/i18n`         | `defineCatalogs`, `createI18n`, `getServerTFor`                                                  |
| `@entifix/i18n/routing` | Locale negotiation and path helpers, with no i18next import — safe for an edge middleware bundle |

---

Tier 2 (adapters) of entifix — a package depends only on its own tier or below. See [the tiers](https://github.com/r10c-technologies/entifix#the-tiers-and-what-you-are-allowed-to-install). MIT licensed.
