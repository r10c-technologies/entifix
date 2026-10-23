# @entifix/service-shell

The skeleton of an Effect HTTP service. `makeService` takes a router and the Layer that satisfies it — a missing dependency is a compile error — and adds the server, logging, OpenTelemetry, `/api/health`, the served entity metadata and graceful shutdown.

Routes are guarded with `requirePermission(...)`, which asks the `PolicyDecision` port from `@entifix/authz`. Hiding a navigation item protects nothing; the route guard does.

## Install

```sh
pnpm add @entifix/service-shell effect
# to run the service:
pnpm add @effect/platform-node
# for telemetry:
pnpm add @opentelemetry/api @effect/opentelemetry @opentelemetry/sdk-trace-base @opentelemetry/sdk-metrics @opentelemetry/exporter-trace-otlp-http @opentelemetry/exporter-metrics-otlp-http @opentelemetry/context-async-hooks
```

## Entry points

| Import                                 | What it holds                                                                                                                                                           |
| -------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@entifix/service-shell`               | What a route set is written against: `requirePrincipal`, `requirePermission`, `requireOrganization`, `requireSharedToken`, `entityMetadataRoute`, health and SSE routes |
| `@entifix/service-shell/runtime`       | Running a service: `makeService`, `makeServerLayer`, `loadRemoteConfiguration`. Needs `@effect/platform-node`                                                           |
| `@entifix/service-shell/observability` | `makeObservabilityLayer` and the OpenTelemetry wiring. Needs `@effect/opentelemetry` and the OpenTelemetry SDK packages                                                 |
| `@entifix/service-shell/testing`       | `serveTestService`, a service on an ephemeral port for a spec                                                                                                           |

The runtime and observability halves are optional peers: a package that only declares routes installs neither. The configuration service's URL and credential, and the header and secret that gate `GET /api/$service`, are values the host passes — `loadRemoteConfiguration({ url, headers })` and `makeService({ description: { header, token } })`.

------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `@entifix/service-shell` | `makeService`, `makeServerLayer`, `requirePrincipal`, `requirePermission`, `requireOrganization`, `entityMetadataRoute`, `loadRemoteConfiguration`, `makeObservabilityLayer`, `serveTestService` |

---

Tier 4 (app framework) of entifix — a package depends only on its own tier or below. See [the tiers](https://github.com/r10c-technologies/entifix#the-tiers-and-what-you-are-allowed-to-install). MIT licensed.
