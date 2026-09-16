# @entifix/next-i18n

Locale routing and server-side translation for a Next.js app. The locale lives in the URL — `/es/catalog` — so a page can be shared in the language it was read in. An unprefixed request is negotiated from the cookie, then `Accept-Language`, and redirected; a prefixed one is rewritten so the rest of the app never sees the prefix.

## Install

```sh
pnpm add @entifix/next-i18n next
```

## Entry points

| Import                      | What it holds                                                                                |
| --------------------------- | -------------------------------------------------------------------------------------------- |
| `@entifix/next-i18n`        | `resolveLocale`, `rewriteToLocale`, `rememberLocale` — for middleware                        |
| `@entifix/next-i18n/server` | `getRequestLocale`, `getServerT`, `getServerTranslateKey` — for server components and routes |

## Optional peers

Install these only if you use what needs them.

| Peer      | Needed by                   |
| --------- | --------------------------- |
| `i18next` | `@entifix/next-i18n/server` |

---

Tier 4 (app framework) of entifix — a package depends only on its own tier or below. See [the tiers](https://github.com/r10c-technologies/entifix#the-tiers-and-what-you-are-allowed-to-install). MIT licensed.
