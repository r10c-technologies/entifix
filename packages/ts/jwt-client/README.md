# @entifix/jwt

Access tokens, on `jose`. `makeJoseTokenService` implements the `TokenService` port from `@entifix/business`: it signs with RS256 and verifies with the algorithm **pinned**, so a token cannot choose how it is checked. `publicJwks` serves the public key for other services to verify against.

⚠️ `unverifiedClaims` reads a token without checking its signature. Use it to shape a UI, never to make a decision.

## Install

```sh
pnpm add @entifix/jwt effect
```

## Entry points

| Import         | What it holds                                                                                                       |
| -------------- | ------------------------------------------------------------------------------------------------------------------- |
| `@entifix/jwt` | `makeJoseTokenService`, `signAccessToken`, `verifyAccessToken`, `publicJwks`, `unverifiedClaims`, `TOKEN_ALGORITHM` |

---

Tier 2 (adapters) of entifix — a package depends only on its own tier or below. See [the tiers](https://github.com/r10c-technologies/entifix#the-tiers-and-what-you-are-allowed-to-install). MIT licensed.
