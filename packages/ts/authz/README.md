# @entifix/authz

The authorization vocabulary. A permission is `<domain>:<entityKey>:<action>` and is derived from the entity's own `@entity({ domain, key })`, so it cannot drift from the thing it guards.

Grants come from a `GrantTable` the application supplies — never from a token. `PolicyDecisionTag` is the port a route asks; `makeStaticPolicyDecision` answers it from that table.

## Install

```sh
pnpm add @entifix/authz effect
```

## Entry points

| Import           | What it holds                                                                                                                        |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `@entifix/authz` | `permissionFor`, `permissionForEntity`, `can`, `GrantTable`, `PolicyDecisionTag`, `makeStaticPolicyDecision`, roles and screen types |

---

Tier 4 (app framework) of entifix — a package depends only on its own tier or below. See [the tiers](https://github.com/r10c-technologies/entifix#the-tiers-and-what-you-are-allowed-to-install). MIT licensed.
