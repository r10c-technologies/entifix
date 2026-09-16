# @entifix/zitadel

A client for the Zitadel identity provider. Zitadel authenticates; your application keeps authorization and mints its own tokens.

- **OIDC** — authorization-code sign-in with PKCE, ID-token verification, and back-channel logout, so the provider can end a session.
- **Management API** — reading and creating users, and querying the provider's event log.
- **Actions** — verifying the signature on a webhook the provider calls, for user lifecycle events such as deactivation.

## Install

```sh
pnpm add @entifix/zitadel effect
```

## Entry points

| Import             | What it holds                                                                                                                          |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------- |
| `@entifix/zitadel` | `makeZitadelOidc`, `makeZitadelManagement`, `makeZitadelActions`, `verifyActionSignature`, `createPkcePair`, `ZitadelHealthProbeLayer` |

Published because the framework's shells use its ports; its integration has unit tests but no example in this repository.

---

Tier 2 (adapters) of entifix — a package depends only on its own tier or below. See [the tiers](https://github.com/r10c-technologies/entifix#the-tiers-and-what-you-are-allowed-to-install). MIT licensed.
