# @entifix/redis

Redis adapters, on `ioredis`: the session and one-time-token stores from `@entifix/business`.

## Install

```sh
pnpm add @entifix/redis effect
```

## Entry points

| Import           | What it holds                                                                                |
| ---------------- | -------------------------------------------------------------------------------------------- |
| `@entifix/redis` | `RedisLayer`, `makeRedisSessionStore`, `makeRedisOneTimeTokenStore`, `RedisHealthProbeLayer` |

---

Tier 2 (adapters) of entifix — a package depends only on its own tier or below. See [the tiers](https://github.com/r10c-technologies/entifix#the-tiers-and-what-you-are-allowed-to-install). MIT licensed.
