# @entifix/core

The entity system. A class decorated with `@entity()` and `@accessor()` describes itself — its members, their types and labels, which of them are sortable or filterable — and everything else in entifix reads that description instead of being told it again.

It also owns what crosses the wire: entity serialization and reconstruction, the envelopes a service answers with, and the RSQL filter and sort protocol a query is written in. Nothing here performs I/O.

## Install

```sh
pnpm add @entifix/core effect
```

## Entry points

| Import          | What it holds                                                                                                                                                        |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@entifix/core` | Decorators (`entity`, `accessor`, `method`, `useCase`), metadata readers, serialization, envelopes, the RSQL parser and serializer, locales, wizard state, selection |

---

Tier 1 (entity) of entifix — a package depends only on its own tier or below. See [the tiers](https://github.com/r10c-technologies/entifix#the-tiers-and-what-you-are-allowed-to-install). MIT licensed.
