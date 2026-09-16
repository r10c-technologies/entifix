# @entifix/sql

The SQL adapter, over `@effect/sql`. `makeSqlRepository` implements the `EntityRepository` port from `@entifix/business` and translates an RSQL filter and sort into parameterised SQL — values are bound, never interpolated, and `LIKE` patterns are escaped.

Bring the `@effect/sql` driver for your database and provide its `SqlClient`; this package does not choose one.

## Install

```sh
pnpm add @entifix/sql effect
```

## Entry points

| Import         | What it holds                                                                                             |
| -------------- | --------------------------------------------------------------------------------------------------------- |
| `@entifix/sql` | `makeSqlRepository`, `translateFiltering`, `translateSorting`, `escapeLikePattern`, `SqlHealthProbeLayer` |

---

Tier 2 (adapters) of entifix — a package depends only on its own tier or below. See [the tiers](https://github.com/r10c-technologies/entifix#the-tiers-and-what-you-are-allowed-to-install). MIT licensed.
