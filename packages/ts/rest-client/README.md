# @entifix/rest

The HTTP adapter, for the browser and for anything else that talks to an entifix service rather than to its database. It implements the same get, load, save and delete a backend adapter does, so a use-case cannot tell which one it was given.

It also reads the entity metadata a service serves, and the status of a write the service accepted asynchronously.

## Install

```sh
pnpm add @entifix/rest effect
```

## Entry points

| Import          | What it holds                                                                                                                                          |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `@entifix/rest` | `buildEntityRestAdapterGet` / `Load` / `Save` / `Delete`, `makeEntityMetadataSource`, `buildTransactionStatusReader`, `performHttpRequestThroughFetch` |

---

Tier 2 (adapters) of entifix — a package depends only on its own tier or below. See [the tiers](https://github.com/r10c-technologies/entifix#the-tiers-and-what-you-are-allowed-to-install). MIT licensed.
