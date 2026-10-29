import {
  type BoundSubscription,
  HealthRegistryTag,
  type HealthReport,
  type ProbeKind,
  ShutdownRegistryTag,
  WiringRegistryTag,
} from '@entifix/business';
import {
  type AnyEndpoint,
  defineEndpoint,
  Failure,
  implement,
  JsonBody,
} from '@entifix/core';
import { Effect, Ref, Schema } from 'effect';
import type { HttpApi } from 'effect/http-api';
import { OpenApi } from 'effect/http-api';

import { type EndpointGroup, endpointGroup } from './build-api.js';

export const SERVICE_DESCRIPTION_PATH = '/api/$service';
export const OPENAPI_PATH = '/api/$openapi';

/**
 * A service that is up but cannot serve yet — a probe failing, or the process
 * draining. `503`, so an orchestrator stops routing to it; the failing probe
 * names ride on the problem.
 */
export class NotReady extends Failure.unavailable<NotReady>()(
  'NotReady',
  'notReady',
  {
    service: Schema.String,
    terminating: Schema.Boolean,
    failing: Schema.Array(Schema.String),
  },
) {}

const HealthStatus = Schema.Struct({
  status: Schema.String,
  service: Schema.String,
});

const DescribedTarget = Schema.Struct({
  /** The Store's register name, an exchange, or a service. Never a URI. */
  name: Schema.String,
  /** The readiness probe that covers it, so the two documents line up. */
  probe: Schema.String,
});

/**
 * What a service says it does — the document a register diffs the service
 * against. `endpoints` is every `METHOD /path` the built API serves.
 */
export const ServiceDescription = Schema.Struct({
  service: Schema.String,
  /** The slices this process hosts; more than one means co-deployment. */
  slices: Schema.Array(Schema.String),
  stores: Schema.Array(DescribedTarget),
  brokers: Schema.Array(DescribedTarget),
  upstreams: Schema.Array(DescribedTarget),
  /** Distinct event names this process has emitted since boot. */
  published: Schema.Array(Schema.String),
  /** The bus bindings this process actually made. */
  subscriptions: Schema.Array(Schema.Unknown),
  endpoints: Schema.Array(Schema.String),
});
export type ServiceDescription = Omit<
  typeof ServiceDescription.Type,
  'subscriptions'
> & { readonly subscriptions: readonly BoundSubscription[] };

const health = defineEndpoint({
  name: 'health',
  method: 'GET',
  path: '/api/health',
  success: HealthStatus,
  errors: [],
  guard: { kind: 'public' },
});

const live = defineEndpoint({
  name: 'live',
  method: 'GET',
  path: '/api/health/live',
  success: HealthStatus,
  errors: [],
  guard: { kind: 'public' },
});

const ready = defineEndpoint({
  name: 'ready',
  method: 'GET',
  path: '/api/health/ready',
  success: HealthStatus,
  errors: [NotReady],
  guard: { kind: 'public' },
});

const description = defineEndpoint({
  name: 'description',
  method: 'GET',
  path: SERVICE_DESCRIPTION_PATH,
  success: ServiceDescription,
  errors: [],
  guard: { kind: 'fleet' },
});

const openapi = defineEndpoint({
  name: 'openapi',
  method: 'GET',
  path: OPENAPI_PATH,
  success: JsonBody,
  errors: [],
  guard: { kind: 'fleet' },
});

const READY_CACHE_MS = 1_000;

interface CacheEntry {
  readonly at: number;
  readonly report: HealthReport;
}

export interface ServiceGroupOptions {
  readonly service: string;
  readonly slices: readonly string[];
  /** Mount `$service` and `$openapi`; absent means neither is served. */
  readonly described: boolean;
  /** Every `METHOD /path` the service serves, for `$service`. */
  readonly endpoints: () => readonly string[];
  /** The built API, for `$openapi`; read after it is built. */
  readonly api: () => HttpApi.Top;
}

/**
 * The endpoints every service serves: liveness, readiness, and — behind the
 * fleet token — its wiring document and its OpenAPI document. The wiring
 * document names every store, exchange and upstream, and an unguarded
 * reconnaissance map is worse than none, so a service with no token serves
 * neither.
 */
export const serviceGroup = (
  options: ServiceGroupOptions,
): EndpointGroup<
  AnyEndpoint,
  HealthRegistryTag | ShutdownRegistryTag | WiringRegistryTag
> => {
  // One cache per server instance (the e2e mock profile boots services
  // in-process, so a module-level cache would leak across them).
  const cache = Ref.makeUnsafe<CacheEntry | null>(null);

  const cachedReport = Effect.gen(function* () {
    const now = Date.now();
    const entry = yield* Ref.get(cache);
    if (entry !== null && now - entry.at < READY_CACHE_MS) return entry.report;

    const registry = yield* HealthRegistryTag;
    const report = yield* registry.report;
    yield* Ref.set(cache, { at: now, report });
    return report;
  });

  const always = [
    implement(health, () =>
      Effect.succeed({ status: 'ok', service: options.service }),
    ),
    implement(live, () =>
      Effect.succeed({ status: 'live', service: options.service }),
    ),
    implement(ready, () =>
      Effect.gen(function* () {
        const shutdown = yield* ShutdownRegistryTag;
        // Ahead of the cache, deliberately: a report cached a moment before
        // the signal landed would go on answering `200` for up to
        // READY_CACHE_MS, which is precisely the window a rolling restart
        // lives in.
        if (yield* shutdown.terminating)
          return yield* Effect.fail(
            new NotReady({
              service: options.service,
              terminating: true,
              failing: [],
            }),
          );
        const report = yield* cachedReport;
        if (!report.ready)
          return yield* Effect.fail(
            new NotReady({
              service: options.service,
              terminating: false,
              failing: report.failing,
            }),
          );
        return { status: 'ready', service: options.service };
      }),
    ),
  ];

  if (!options.described) return endpointGroup('service', ...always);

  return endpointGroup(
    'service',
    ...always,
    implement(description, () =>
      Effect.gen(function* () {
        const registry = yield* HealthRegistryTag;
        const wiring = yield* WiringRegistryTag;
        const probes = yield* registry.probes;

        const ofKind = (kind: ProbeKind) =>
          probes
            .filter(probe => probe.kind === kind)
            .flatMap(probe =>
              probe.targets.map(name => ({ name, probe: probe.name })),
            );

        return {
          service: options.service,
          slices: options.slices,
          stores: ofKind('datastore'),
          brokers: ofKind('broker'),
          upstreams: ofKind('upstream'),
          published: yield* wiring.published,
          subscriptions: yield* wiring.subscriptions,
          endpoints: options.endpoints(),
        };
      }),
    ),
    implement(openapi, () =>
      Effect.sync(() => OpenApi.fromApi(options.api() as never)),
    ),
  );
};
