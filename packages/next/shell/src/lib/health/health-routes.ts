/**
 * Probe route handlers for the Next apps, mirroring what
 * `@entifix/service-shell` mounts on the backends.
 *
 * They ship from `@entifix/next-shell/server` because a route handler must
 * not come from the `"use client"` bundle.
 */

import type { ConfigurationSource } from '../config/configuration-source.js';

/** How long a readiness result is reused, so probes cannot hammer config-service. */
const READY_CACHE_MS = 1_000;

/** A readiness check that hangs is a readiness check that failed. */
const READY_TIMEOUT_MS = 2_000;

/**
 * Which build is answering: `next dev` or `next start`.
 *
 * Liveness carries it because an e2e run needs to know *which artifact* it
 * attached to. Playwright reuses whatever already listens on the app's port, so
 * a suite started while a dev server is up tests a different bundle against a
 * different backend than the one it claims to — see `assertExpectedServer` in
 * `@entifix/testing-e2e/playwright`.
 *
 * On liveness rather than readiness because liveness is the one endpoint that
 * answers from the process alone, before config-service or any backend is up.
 *
 * Not an information leak worth avoiding: a dev build already announces itself
 * in its asset paths long before anything asks this endpoint.
 */
const buildMode = (): 'development' | 'production' =>
  process.env.NODE_ENV === 'production' ? 'production' : 'development';

interface ReadyState {
  readonly at: number;
  readonly ready: boolean;
}

export interface HealthRouteOptions {
  /** The app's package name, echoed back so a probe says what it reached. */
  readonly app: string;
  /** The configuration readiness checks — the same source `/api/config` reads. */
  readonly configuration: ConfigurationSource;
}

/**
 * Build the `GET` handlers for `/api/health`, `/api/health/live` and
 * `/api/health/ready`.
 *
 * **Liveness** answers from the process alone — no config-service, no backend,
 * no session. That is what makes it usable as Playwright's `readyPath` and what
 * keeps a dependency blip from getting the app killed by Kubernetes later.
 *
 * **Readiness** checks the one dependency the app cannot render without: its
 * configuration. It deliberately does *not* chain to the domain backend —
 * cascading readiness turns one degraded service into a fleet-wide outage, and
 * a page that renders with a degraded backend is still worth serving.
 */
export const createHealthRoutes = (options: HealthRouteOptions) => {
  let cached: ReadyState | null = null;

  const checkConfig = async (): Promise<boolean> => {
    try {
      // The source's headers are not optional here: a configuration service
      // that gates its lookup answers `401` without them, which a readiness
      // probe reads as "degraded" — permanently, for an app that is in fact fine.
      const { url, headers } = options.configuration();
      const response = await fetch(url, {
        signal: AbortSignal.timeout(READY_TIMEOUT_MS),
        cache: 'no-store',
        headers,
      });
      return response.ok;
    } catch {
      return false;
    }
  };

  return {
    /** `GET /api/health` — the original endpoint, unchanged. */
    health: () => Response.json({ status: 'ok', app: options.app }),

    /** `GET /api/health/live` */
    live: () =>
      Response.json({
        status: 'live',
        app: options.app,
        mode: buildMode(),
      }),

    /** `GET /api/health/ready` */
    ready: async () => {
      const now = Date.now();
      if (cached === null || now - cached.at >= READY_CACHE_MS) {
        cached = { at: now, ready: await checkConfig() };
      }

      return cached.ready
        ? Response.json({ status: 'ready', app: options.app })
        : Response.json(
            { status: 'degraded', app: options.app, failing: ['config'] },
            { status: 503 },
          );
    },
  };
};
