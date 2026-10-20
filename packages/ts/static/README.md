# @entifix/static

A read-only `EntityRepository` over records bundled with the build — the content of a static-export site, served through the ordinary use cases and swappable for `@entifix/rest` the day a backend appears.

`get` and `load` have the Mongo adapter's semantics: every filter operator, groups, array membership, a dotted path into one locale of a `localized` member, multi-key sorting and 1-based paging. `save` and `delete` fail with an `EntifixLogicError`, because a static source is read-only.

Records that arrive as JSON are checked against the entity's metadata before anything is served (`validRecordsOrThrow` from `@entifix/core`): identity, `required`, member types, dates, link ids, item counts, `notBefore`, cardinality and localized completeness. Every problem is thrown together, so a broken record fails the build instead of a visitor's page.

```ts
const posts = staticRepositoryFromRecords(Post, postsJson, {
  source: 'posts.json',
  linkTargets: { tags: new Set(tagsJson.map(tag => tag.id)) },
});
```

## Install

```sh
pnpm add @entifix/static effect
```

## Entry points

| Import            | What it holds                                         |
| ----------------- | ----------------------------------------------------- |
| `@entifix/static` | `makeStaticRepository`, `staticRepositoryFromRecords` |

---

Tier 2 (adapters) of entifix — a package depends only on its own tier or below. See [the tiers](https://github.com/r10c-technologies/entifix#the-tiers-and-what-you-are-allowed-to-install). MIT licensed.
