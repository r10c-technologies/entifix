# @entifix/redis

Redis adapters, on `ioredis`. The root entry implements the session and one-time-token stores from `@entifix/business`; the `transactions` subpath implements the lock and sequence services `@entifix/transactions` depends on.

A session store does not arrive with a saga engine attached: the transactions half is behind its own subpath, and `@entifix/transactions` is an optional peer.

## Install

```sh
pnpm add @entifix/redis effect
```

## Entry points

| Import                        | What it holds                                                                                |
| ----------------------------- | -------------------------------------------------------------------------------------------- |
| `@entifix/redis`              | `RedisLayer`, `makeRedisSessionStore`, `makeRedisOneTimeTokenStore`, `RedisHealthProbeLayer` |
| `@entifix/redis/transactions` | `makeRedisLockService`, `makeRedisSequenceService`                                           |

## Optional peers

Install these only if you use what needs them.

| Peer                    | Needed by                     |
| ----------------------- | ----------------------------- |
| `@entifix/transactions` | `@entifix/redis/transactions` |

---

Tier 2 (adapters) of entifix — a package depends only on its own tier or below. See [the tiers](https://github.com/r10c-technologies/entifix#the-tiers-and-what-you-are-allowed-to-install). MIT licensed.
