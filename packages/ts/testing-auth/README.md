# @entifix/testing-auth

Authentication stubs for tests that need a signed-in principal and do not care how it got there: a token service that always answers the same claims, a policy that grants every request, and a session cookie to send.

Test-only. Depend on it as a `devDependency`.

## Install

```sh
pnpm add -D @entifix/testing-auth
```

## Entry points

| Import                  | What it holds                                                                                                                   |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `@entifix/testing-auth` | `makeFixedTokenService`, `FixedTokenServiceLayer`, `AllowAllPolicyLayer`, `stubAccessToken`, `stubSessionCookie`, `STUB_CLAIMS` |

---

Tier 5 (testing) of entifix — a package depends only on its own tier or below. See [the tiers](https://github.com/r10c-technologies/entifix#the-tiers-and-what-you-are-allowed-to-install). MIT licensed.
