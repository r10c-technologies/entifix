# @entifix/service-shell

The skeleton of an Effect HTTP service. `makeService` takes a router and the Layer that satisfies it — a missing dependency is a compile error — and adds the server, logging, OpenTelemetry, `/api/health`, the served entity metadata and graceful shutdown.

Routes are guarded with `requirePermission(...)`, which asks the `PolicyDecision` port from `@entifix/authz`. Hiding a navigation item protects nothing; the route guard does.

## Install

```sh
pnpm add @entifix/service-shell @opentelemetry/api effect
```

## Entry points

| Import                   | What it holds                                                                                                                                                                                    |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `@entifix/service-shell` | `makeService`, `makeServerLayer`, `requirePrincipal`, `requirePermission`, `requireOrganization`, `entityMetadataRoute`, `loadRemoteConfiguration`, `makeObservabilityLayer`, `serveTestService` |

---

Tier 4 (app framework) of entifix — a package depends only on its own tier or below. See [the tiers](https://github.com/r10c-technologies/entifix#the-tiers-and-what-you-are-allowed-to-install). MIT licensed.
