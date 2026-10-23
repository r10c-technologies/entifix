import { createServer } from 'node:http';

import { NodeHttpServer, NodeRuntime } from '@effect/platform-node';
import {
  HealthRegistryLayer,
  HealthRegistryTag,
  makeShutdownRegistry,
  type ShutdownRegistry,
  ShutdownRegistryTag,
  WiringRegistryLayer,
  WiringRegistryTag,
} from '@entifix/business';
import { Effect, Layer } from 'effect';
import { HttpRouter } from 'effect/http';

import type { SharedToken } from './auth/shared-token.js';
import { healthRoutes } from './health-routes.js';
import { serviceDescriptionRoute } from './service-description-route.js';

/**
 * A service's routes: `HttpRouter.add` / `HttpRouter.addAll` layers, merged
 * with `Layer.mergeAll`. Its requirements carry, as `HttpRouter` request
 * markers, the domain services the handlers need.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type ServiceRoutes<R = any> = Layer.Layer<never, never, R>;

/**
 * What a service's `appLayer` must provide for routes requiring `R`: the
 * services their handlers read per request, plus anything building the route
 * layers themselves needs.
 */
export type RoutesRequirements<R> =
  | HttpRouter.Request.Only<'Requires', R>
  | HttpRouter.Request.Without<Exclude<R, HttpRouter.HttpRouter>>;

/** The registries {@link makeServerLayer} provides to every `appLayer`. */
export type ServiceRegistries =
  HealthRegistryTag | ShutdownRegistryTag | WiringRegistryTag;

/**
 * Definition of an Effect-native backend service.
 *
 * `router` carries the service's routes and, in its requirements, the exact set
 * of domain services those routes need. `appLayer` must provide them — the
 * composition root. Because the requirements are tracked in the type, a
 * missing dependency is a COMPILE error at `makeService`, not a runtime
 * surprise: the launched layer must require nothing. This is the uniform
 * skeleton every `*-service` composes; the HTTP server, logging,
 * `/api/health`, and graceful shutdown live here so services stay thin.
 */
export interface ServiceDefinition<RRoutes> {
  /** Service name, surfaced on `/api/health`. */
  readonly name: string;
  /** Port to bind. Convention: 310N for domain services, 319x for platform. */
  readonly port: number;
  /**
   * The slices this process hosts, by their `tools/slices/` name.
   *
   * It cannot be derived. `EventSourceTag` names only the *emitting* slice, and
   * one deployment may host several: ADR 0021 co-deploys `transaction` inside
   * marketplace-admin-service. `dev-infra:map` checks each name against the
   * register's own `deployments`, so a wrong one fails the diff rather than
   * quietly mislabelling the fleet.
   */
  readonly slices: readonly string[];
  /**
   * The token that gates `GET /api/$service`, the service's wiring document.
   *
   * Optional, and **absent means the route is not mounted** rather than served
   * open: the document names every store, exchange and upstream the service
   * has, and an unguarded reconnaissance map is worse than none.
   */
  readonly description?: SharedToken;
  /** The service's routes; their requirements are satisfied by `appLayer`. */
  readonly router: ServiceRoutes<RRoutes>;
  /**
   * Composition root providing everything `router` requires.
   *
   * It may also *require* {@link HealthRegistryTag} — that is how a client
   * layer's readiness probe registers itself — {@link WiringRegistryTag}, which
   * is how the bus records what it bound, and {@link ShutdownRegistryTag},
   * which is how it registers what draining it means. All three instances are
   * provided here, once, so the probes, the bus, the drain and the routes that
   * read them share one apiece.
   */
  readonly appLayer: Layer.Layer<
    RoutesRequirements<RRoutes>,
    never,
    ServiceRegistries
  >;
}

/**
 * The service as a `Layer`: `/api/health` mounted, `router` served over an
 * `@effect/platform-node` HTTP server with request logging, `appLayer`
 * provided.
 *
 * Split out of {@link makeService} so the same wiring can be launched more than
 * one way. `makeService` runs it under `runMain` for production; the e2e mock
 * profile launches it in-process on an ephemeral port (see `serveTestService`).
 * Sharing this function is the point — a second assembly of router + health +
 * middleware would let the thing under test drift from the thing that ships.
 *
 * `port` overrides `def.port`, which is what an in-process boot needs.
 * `shutdown` overrides the registry, which is what {@link makeService} needs:
 * only a real process boot has a SIGTERM to latch, and an in-process e2e boot
 * that installed one would leave a process listener per service it started.
 */
export const makeServerLayer = <RRoutes>(
  def: ServiceDefinition<RRoutes>,
  port: number = def.port,
  shutdown: ShutdownRegistry = makeShutdownRegistry().registry,
) => {
  const routes = Layer.mergeAll(
    def.router,
    healthRoutes(def.name),
    def.description === undefined
      ? Layer.empty
      : serviceDescriptionRoute(def.name, def.slices, def.description),
    // Permissive CORS (frontends call these services cross-origin from their
    // dev ports). Tighten per-environment later.
    HttpRouter.cors(),
  );

  // `provideMerge` (not `provide`) so the registries the client layers
  // registered into are the same instances the readiness and description routes
  // read.
  const appLayer = def.appLayer.pipe(
    Layer.provideMerge(
      Layer.mergeAll(
        HealthRegistryLayer,
        WiringRegistryLayer,
        Layer.succeed(ShutdownRegistryTag, shutdown),
      ),
    ),
  );

  // The graceful shutdown, and its **position** is the mechanism (ADR 0030).
  // Build order is `appLayer` → this → `serve`, so release order is the
  // reverse: the drain runs after the server has stopped taking requests and
  // *before* the connections it needs are closed. A signal handler could not
  // give that ordering — `runMain` interrupts the fiber on SIGTERM, and a
  // handler racing that interrupt would drain against a closing client.
  const drained = Layer.provideMerge(
    Layer.effectDiscard(
      Effect.acquireRelease(Effect.void, () => shutdown.drain),
    ),
    appLayer,
  );

  // `HttpRouter.serve` logs every request unless told not to, which is the
  // request logging `HttpMiddleware.logger` used to add here.
  const served = HttpRouter.serve(routes).pipe(
    Layer.provide(drained),
    Layer.provide(NodeHttpServer.layer(() => createServer(), { port })),
  );
  // `ServiceDefinition` already proved `appLayer` covers what the routes need;
  // TypeScript cannot carry that proof through `Exclude` on a type parameter,
  // so the closed requirement set is stated here rather than re-derived.
  return served as Layer.Layer<
    Layer.Success<typeof served>,
    Layer.Error<typeof served>
  >;
};

/**
 * Boot an Effect service: build {@link makeServerLayer} and launch it under
 * `runMain` (SIGINT/SIGTERM interrupt the fiber, so Layer finalizers — the
 * shutdown drain, then the db pools — release deterministically).
 *
 * The signal listeners here do **one** thing: flip the readiness latch, in the
 * same tick `runMain`'s own listener starts the interrupt, so
 * `GET /api/health/ready` stops claiming to be ready immediately rather than
 * when the finalizers get around to running. The draining itself is the
 * finalizer's, because only layer ordering can guarantee the connections are
 * still open while it happens.
 *
 * The `preStop` grace period ADR 0030 also names is **not** here and could not
 * be: Kubernetes runs it before it sends SIGTERM, and this repo declares no
 * Deployment for a service. It lands with the first one.
 */
export const makeService = <RRoutes>(def: ServiceDefinition<RRoutes>): void => {
  const shutdown = makeShutdownRegistry();
  process.once('SIGTERM', shutdown.begin);
  process.once('SIGINT', shutdown.begin);

  NodeRuntime.runMain(
    Layer.launch(makeServerLayer(def, def.port, shutdown.registry)),
  );
};
