import { DEADLINE_HEADER, UpstreamUnavailable } from '@entifix/core';
import { NextResponse } from 'next/server';

import { bearerHeader, sessionToken } from '../session/bearer.js';
import { problemResponse } from './problem-response.js';

type Params = { params: Promise<{ path: string[] }> };

export interface ServiceProxyRouteOptions {
  /** Where the service listens, without the `/api` suffix. */
  readonly baseUrl: string;
  /**
   * A segment to put back in front of the forwarded path.
   *
   * ⚠️ **Needed when the proxy's namespace *is* the upstream's route name.**
   * `/api/stock/stock-item` forwards to `/api/stock-item` because `stock` names
   * the service and `stock-item` names the entity — two different words. But
   * where the namespace and the route are the same word — `/api/realtime/flow`
   * served by a service whose own route is `/api/realtime/flow` — stripping it
   * strips half the address, and every probe stays green while the route
   * 404s.
   */
  readonly pathPrefix?: string;
}

/**
 * Builds a same-origin proxy for one backend service, mounted as a catch-all
 * route handler — e.g. `app/api/admin/[...path]/route.ts`.
 *
 * The browser can never call `:310N` directly: `entifix_at` is httpOnly and
 * same-origin, so a cross-origin request carries no cookie and a guarded route
 * answers `401`. Host-scoping the cookie does not help — that governs which host
 * *stores* it, not which cross-origin requests send it. Routing through the app's
 * own origin makes the cookie automatic and needs no CORS, which is the same
 * reason the credential routes are shaped this way.
 *
 * The cookie is forwarded upstream as a bearer token. **This proxy grants
 * nothing** — the service still verifies the token and applies its own
 * the endpoint's `guard`. It only carries.
 *
 * It also carries the **caching contract** in both directions, which it did not
 * always: rebuilding every response as a fresh body dropped `ETag`,
 * `Cache-Control` and `Vary`, and forwarded no `If-None-Match`. The effect was
 * invisible and entirely wasteful — `GET /api/<entity>/$metadata` computes and
 * hashes a permission-filtered document per request, and a validator that never
 * reaches the service means it can never answer `304`. Worse, `Vary` is a
 * *correctness* header here: the document differs per caller, and one stripped
 * of `Vary: Cookie, Authorization` may be cached and served to a different
 * principal.
 *
 * A factory, because a host mounts one of these per backend it talks to, and
 * back-office-app now talks to two: marketplace-admin-service for the catalog a
 * vendor authors, marketplace-service for the platform vocabulary it is
 * classified in.
 */
/**
 * Response headers that must survive the rebuild.
 *
 * Deliberately a short allow-list rather than copying every header: the
 * upstream's `content-length` and `content-encoding` describe *its* body, and
 * carrying them onto a response this function reconstructs is how a proxy
 * serves a truncated payload. Beside the cache validators: `retry-after`,
 * which says when an overloaded service wants to be asked again; `location`,
 * which a `202` points its tracker at; and `traceparent`, so the browser's
 * failure toast can name the trace a service logged its side under.
 */
const PASSED_RESPONSE_HEADERS = [
  'etag',
  'cache-control',
  'vary',
  'retry-after',
  'location',
  'traceparent',
] as const;

/**
 * Request headers forwarded to the service, beside the bearer it gets from
 * the session: the validator, so `$metadata` can answer `304`; the
 * idempotency key, so a retried write is recognised; the trace, so one
 * request is one trace across the hop; and the caller's remaining budget
 * ([ADR 0014](../../../../../../docs/adr/0014-retry-once-at-the-layer-above-under-a-budget.md)).
 */
const FORWARDED_REQUEST_HEADERS = [
  'if-none-match',
  'idempotency-key',
  'traceparent',
  DEADLINE_HEADER,
] as const;

const passThrough = (upstream: Response): Record<string, string> => {
  const headers: Record<string, string> = {};
  for (const name of PASSED_RESPONSE_HEADERS) {
    const value = upstream.headers.get(name);
    if (value !== null) headers[name] = value;
  }
  return headers;
};

export const createServiceProxyRoute = ({
  baseUrl,
  pathPrefix,
}: ServiceProxyRouteOptions) => {
  const forward = async (
    request: Request,
    { params }: Params,
  ): Promise<Response> => {
    const { path } = await params;
    const search = new URL(request.url).search;

    const headers: Record<string, string> = {
      'content-type': 'application/json',
      ...bearerHeader(await sessionToken()),
    };

    for (const name of FORWARDED_REQUEST_HEADERS) {
      const value = request.headers.get(name);
      if (value !== null) headers[name] = value;
    }

    const hasBody = request.method !== 'GET' && request.method !== 'DELETE';
    const body = hasBody ? await request.text() : undefined;
    // Only the connection is caught. A service that answers — with anything,
    // a `500` included — is passed through below exactly as it answered.
    const upstream = await fetch(
      `${baseUrl}/api/${[pathPrefix, ...path].filter(Boolean).join('/')}${search}`,
      { method: request.method, headers, body, cache: 'no-store' },
    ).catch(() => undefined);

    // `502`, never the `500` an unhandled rejection becomes: the host did
    // nothing wrong, and a `500` sends whoever reads it looking for a bug in
    // the app rather than for a process that is not running.
    if (upstream === undefined) {
      return problemResponse(
        new UpstreamUnavailable(
          pathPrefix === undefined ? {} : { upstream: pathPrefix },
        ),
        {
          status: 502,
        },
      );
    }

    const passed = passThrough(upstream);

    // A `304` carries no body by definition, and neither does a `204`. Running
    // either through a body read is not merely wasteful — a `304` reconstructed
    // with a body is no longer a `304`.
    if (upstream.status === 304) {
      return new NextResponse(null, { status: 304, headers: passed });
    }

    // 204s and empty bodies must not be given a body. The upstream's content
    // type is kept, never re-typed: a problem body re-typed as plain JSON is
    // one the browser can no longer recognise as a failure it can decode.
    const text = await upstream.text();
    return text === ''
      ? new NextResponse(null, { status: upstream.status, headers: passed })
      : new NextResponse(text, {
          status: upstream.status,
          headers: {
            ...passed,
            'content-type':
              upstream.headers.get('content-type') ?? 'application/json',
          },
        });
  };

  return forward;
};
