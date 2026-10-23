import { NextResponse } from 'next/server';

import type { ConfigurationSource } from './configuration-source.js';

/** A group of parameters as `ConfigurationPlain` carries them. */
type PlainConfiguration = Record<
  string,
  Array<{ key: string; value: unknown }>
>;

/**
 * Rewrites backend addresses to the app's own same-origin proxy paths.
 *
 * config-service holds the real address, which is what the *server* needs. A
 * browser pointed at it would be making a cross-origin request that carries no
 * session cookie and gets a `401` — `entifix_at` is httpOnly and same-origin, and
 * host-scoping it does not help, since that governs which host stores the cookie
 * rather than which cross-origin requests send it.
 *
 * So each service domain is swapped for a path on this app's own origin before
 * the browser ever sees it, which leaves the entity adapters unaware that a proxy
 * exists at all. `map` is keyed by the configuration key, e.g.
 * `{ 'config-service-domain': '/api/system' }`.
 *
 * Keys absent from `map` are passed through untouched, so an app only names the
 * domains it actually proxies.
 */
export const rewriteServiceDomains = (
  plain: PlainConfiguration,
  map: Readonly<Record<string, string>>,
): PlainConfiguration => ({
  ...plain,
  uri: (plain['uri'] ?? []).map(parameter =>
    parameter.key in map
      ? { ...parameter, value: map[parameter.key] }
      : parameter,
  ),
});

export interface ConfigRouteOptions {
  /** Where this app's configuration is fetched from, and with what headers. */
  readonly source: ConfigurationSource;
  /** Service domains to rewrite to same-origin proxy paths. */
  readonly proxies?: Readonly<Record<string, string>>;
}

/**
 * Builds the `GET /api/config` route handler every Next app exposes: fetch this
 * app's configuration from its source, rewrite the proxied domains, and hand the
 * result to the browser.
 */
export const createConfigRoute = ({
  source,
  proxies = {},
}: ConfigRouteOptions) =>
  async function GET(): Promise<Response> {
    const { url, headers } = source();

    const response = await fetch(url, { cache: 'no-store', headers });

    if (!response.ok) {
      return NextResponse.json(
        { error: 'Failed to load configuration' },
        { status: 502 },
      );
    }

    const plain = (await response.json()) as PlainConfiguration;

    return NextResponse.json(rewriteServiceDomains(plain, proxies));
  };
