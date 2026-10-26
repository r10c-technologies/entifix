# @entifix/business

The ports an application is written against, and the generic use-cases that run over them. A use-case depends on `EntityRepositoryTag`, never on a database, so the same code runs in a browser against `@entifix/rest` and on a backend against `@entifix/mongo` or `@entifix/sql` — the adapter is chosen where the application is composed.

Ports are Effect `Context.Service`s: repository, link resolver, session and one-time-token stores, token service, tenant database resolver, and the health, shutdown and wiring registries.

## Install

```sh
pnpm add @entifix/business effect
```

## Entry points

| Import              | What it holds                                                                                                                                                                                                                                                                                                                                                         |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@entifix/business` | Port tags (the facet counter, `EntityFacetCounterTag` and its factory, beside the repository), `getUCFactory` / `loadUCFactory` / `saveUCFactory` / `deleteUCFactory`, `facetCountsUCFactory`, `loadAllUCFactory` (every record a request keeps, page by page), `resolveLinksUCFactory` (chosen links of many records), `HealthRegistryLayer`, `makeShutdownRegistry` |

---

Tier 1 (entity) of entifix — a package depends only on its own tier or below. See [the tiers](https://github.com/r10c-technologies/entifix#the-tiers-and-what-you-are-allowed-to-install). MIT licensed.
