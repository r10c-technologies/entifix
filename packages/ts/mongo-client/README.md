# @entifix/mongo

The MongoDB adapter. `makeMongoRepository` implements the `EntityRepository` port from `@entifix/business`, translating an RSQL filter and sort into a Mongo query, and `makeMongoTenantResolver` hands each request the database of the organization it belongs to.

`MongoClientLayer` owns the connection pool for the life of the process; a per-organization database is resolved inside the request, never built as a Layer per request.

## Install

```sh
pnpm add @entifix/mongo effect
```

## Entry points

| Import                        | What it holds                                                                                           |
| ----------------------------- | ------------------------------------------------------------------------------------------------------- |
| `@entifix/mongo`              | Repository, link resolver, query translation, client and database Layers, tenant resolver, health probe |
| `@entifix/mongo/transactions` | Transactional outbox and inbox for `@entifix/transactions`, with the relay that drains the outbox       |

## Optional peers

Install these only if you use what needs them.

| Peer                    | Needed by                     |
| ----------------------- | ----------------------------- |
| `@entifix/transactions` | `@entifix/mongo/transactions` |

---

Tier 2 (adapters) of entifix — a package depends only on its own tier or below. See [the tiers](https://github.com/r10c-technologies/entifix#the-tiers-and-what-you-are-allowed-to-install). MIT licensed.
