import {
  decodeProblem,
  defaultLocale,
  type EntifixFailure,
  InvalidQuery,
  isLocale,
  type Locale,
  LOCALE_COOKIE,
  LOCALE_HEADER,
  ProtocolFailure,
  Timeout,
  Unauthenticated,
  UpstreamUnavailable,
} from '@entifix/core';
import { NextResponse } from 'next/server';

import { problemResponse } from '../config/problem-response.js';
import { bearerHeader, sessionToken } from '../session/bearer.js';
import type {
  RecordSearchGroup,
  RecordSearchResponse,
  RecordSearchUnavailable,
} from './record-search.types.js';
import type { RecordSearchSource } from './record-search-source.js';

export const SEARCH_TERM_PARAM = 'q';
export const SEARCH_SOURCES_PARAM = 'sources';
export const SEARCH_LIMIT_PARAM = 'limit';
/** The reader's locale, which a localized member is searched, sorted and read in. */
export const SEARCH_LOCALE_PARAM = 'locale';

/**
 * Below this, nothing is queried at all.
 *
 * A `like` becomes an unanchored `$regex` that ignores accents and case, which no index can
 * serve — so this endpoint is a collection scan by construction. One character
 * matches most of every collection and is worth nothing to the person typing, so
 * the floor costs them nothing and saves four scans per keystroke.
 */
export const MIN_TERM_LENGTH = 2;
export const DEFAULT_GROUP_LIMIT = 5;
export const MAX_GROUP_LIMIT = 20;
export const DEFAULT_SOURCE_TIMEOUT_MS = 1_500;

export interface RecordSearchRouteOptions {
  /**
   * The sources to fan out over, **in the order results are presented**. That
   * order is the ranking: an operator learns where a kind of record lands, which
   * a relevance score across four unrelated entities cannot offer.
   */
  readonly sources: readonly RecordSearchSource[];
  /** Per-source budget. Concurrent, so this also bounds the whole request. */
  readonly timeoutMs?: number;
  /** Records per group. */
  readonly limit?: number;
}

type SourceOutcome =
  | { readonly ok: true; readonly group: RecordSearchGroup }
  | { readonly ok: false; readonly unavailable: RecordSearchUnavailable };

const unavailable = (
  source: RecordSearchSource,
  failure: EntifixFailure,
  status?: number,
): SourceOutcome => ({
  ok: false,
  unavailable: {
    source: source.key,
    entity: source.entity,
    reason: failure.code,
    category: failure.category,
    ...(status === undefined ? {} : { status }),
  },
});

type Fetched =
  | { readonly ok: true; readonly body: unknown; readonly status: number }
  | { readonly ok: false; readonly outcome: SourceOutcome };

/**
 * One upstream read for a source, as a body or as the outcome that says why
 * there is none — the source named either way.
 */
const fetchBody = async (
  source: RecordSearchSource,
  url: string,
  token: string | undefined,
  timeoutMs: number,
): Promise<Fetched> => {
  let upstream: Response;
  try {
    upstream = await fetch(url, {
      headers: bearerHeader(token),
      cache: 'no-store',
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    // `AbortSignal.timeout` rejects with a `DOMException` named `TimeoutError`;
    // branching on the name rather than the class keeps this reachable from a
    // test without fabricating a platform error.
    return {
      ok: false,
      outcome: unavailable(
        source,
        (error as { name?: string }).name === 'TimeoutError'
          ? new Timeout({ dependency: source.key })
          : new UpstreamUnavailable({ upstream: source.key }),
      ),
    };
  }

  // The service says why, in a problem body; the code is the reason. A body
  // that is not one decodes as `protocol` — still named, never silent.
  if (!upstream.ok) {
    const body: unknown = await upstream.json().catch(() => undefined);
    return {
      ok: false,
      outcome: unavailable(
        source,
        decodeProblem(body, upstream.status),
        upstream.status,
      ),
    };
  }

  return {
    ok: true,
    body: await upstream.json().catch(() => undefined),
    status: upstream.status,
  };
};

const unreadable = (source: RecordSearchSource, status: number) =>
  unavailable(
    source,
    new ProtocolFailure({
      reason: `${source.key} answered a page the source cannot read`,
      upstreamStatus: status,
    }),
    status,
  );

const groupOf = (
  source: RecordSearchSource,
  page: { items: RecordSearchGroup['items']; total: number },
): SourceOutcome => ({
  ok: true,
  group: {
    source: source.key,
    entity: source.entity,
    labelKey: source.labelKey,
    items: page.items,
    total: page.total,
  },
});

/**
 * Ask one source, and **never reject**.
 *
 * Returning a typed outcome rather than throwing is what makes the fan-out a
 * plain `Promise.all`: isolation comes from this catch, not from
 * `allSettled` — whose rejected arm would then be unreachable and untestable.
 *
 * A source searched through a reference takes two reads, one after the
 * other, both under the caller's own session: the referenced records whose
 * name matches the term, at their owner, then this source's records that
 * refer to them. No match is an empty group without the second read, and
 * either read failing degrades the group exactly as one read would.
 */
const runSource = async (
  source: RecordSearchSource,
  term: string,
  limit: number,
  locale: Locale,
  token: string | undefined,
  timeoutMs: number,
): Promise<SourceOutcome> => {
  let names: ReadonlyMap<string, string> | undefined;
  let url: string;
  if (source.through === undefined) {
    url = source.url(term, limit, locale);
  } else {
    const matched = await fetchBody(
      source,
      source.through.url(term, limit, locale),
      token,
      timeoutMs,
    );
    if (!matched.ok) return matched.outcome;
    const matches = source.through.read(matched.body, locale);
    if (matches === undefined) return unreadable(source, matched.status);
    if (matches.length === 0) return groupOf(source, { items: [], total: 0 });
    names = new Map(matches.map(match => [match.id, match.label]));
    url = source.through.urlFor([...names.keys()], limit);
  }

  const fetched = await fetchBody(source, url, token, timeoutMs);
  if (!fetched.ok) return fetched.outcome;
  const page = source.read(fetched.body, locale, names);
  return page === undefined
    ? unreadable(source, fetched.status)
    : groupOf(source, page);
};

/**
 * The locale a search runs in: the one the caller names, else the one the
 * host's locale proxy forwarded, else the reader's locale cookie, else the
 * host's default. Anything that is not a declared locale is passed over.
 */
const requestLocale = (request: Request, params: URLSearchParams): Locale => {
  const cookie = (request.headers.get('cookie') ?? '')
    .split(';')
    .map(part => part.trim().split('='))
    .find(([name]) => name === LOCALE_COOKIE)?.[1];
  return (
    [
      params.get(SEARCH_LOCALE_PARAM),
      request.headers.get(LOCALE_HEADER),
      cookie,
    ].find(isLocale) ?? defaultLocale()
  );
};

const clampLimit = (raw: string | null, fallback: number): number => {
  const asked = Number(raw);
  if (!Number.isInteger(asked) || asked < 1) return fallback;
  return Math.min(asked, MAX_GROUP_LIMIT);
};

/**
 * `GET /api/search` — records matching a term, across every source this host
 * mounts.
 *
 * The caller's own session is the only credential that crosses: each source is
 * asked over the same guarded route its screens use, so what comes back is
 * already authorized for this principal and this organization. There is no
 * index, and there must never be one — a prefetched index is a tenant leak, and
 * it is the reason this is a fan-out rather than a search service.
 *
 * A source that fails is **named** in `unavailable` rather than dropped. An
 * absent group renders as "no matches", which is a confident claim the server is
 * in no position to make about a service it could not reach.
 */
export const createRecordSearchRoute = ({
  sources,
  timeoutMs = DEFAULT_SOURCE_TIMEOUT_MS,
  limit: defaultLimit = DEFAULT_GROUP_LIMIT,
}: RecordSearchRouteOptions) => {
  const byKey = new Map(sources.map(source => [source.key, source]));

  return async function GET(request: Request): Promise<Response> {
    // The services decide what this caller may read; this only carries the
    // token. But the gate is not redundant: `catalog-reference` reads are
    // unauthenticated at the service by design, so without it a signed-out
    // caller gets brand matches back and the answer reads as a real search —
    // and the endpoint becomes an anonymous amplifier against that service.
    const token = await sessionToken();
    if (token === undefined) {
      return problemResponse(new Unauthenticated());
    }

    const params = new URL(request.url).searchParams;

    const asked = (params.get(SEARCH_SOURCES_PARAM) ?? '')
      .split(',')
      .filter(name => name !== '');
    const unknown = asked.find(name => !byKey.has(name));
    if (unknown !== undefined) {
      // Loud rather than ignored: no keystroke can produce this, only a caller
      // naming a source that does not exist — and silently searching everything
      // instead would answer a question nobody asked.
      return problemResponse(
        new InvalidQuery({ reason: `unknown search source "${unknown}"` }),
      );
    }
    const selected =
      asked.length === 0
        ? sources
        : sources.filter(source => asked.includes(source.key));

    const term = (params.get(SEARCH_TERM_PARAM) ?? '').trim();
    const answer = (body: RecordSearchResponse) =>
      // The body is scoped to one principal and one organization. `no-store` is
      // correctness here, not tuning.
      NextResponse.json(body, { headers: { 'cache-control': 'no-store' } });

    if (term.length < MIN_TERM_LENGTH) {
      return answer({ term, groups: [], unavailable: [] });
    }

    const limit = clampLimit(params.get(SEARCH_LIMIT_PARAM), defaultLimit);
    const locale = requestLocale(request, params);
    const outcomes = await Promise.all(
      selected.map(source =>
        runSource(source, term, limit, locale, token, timeoutMs),
      ),
    );

    return answer({
      term,
      // Declared order, never completion order — otherwise the list reshuffles
      // with the network and nobody can learn where anything lands.
      groups: outcomes.flatMap(outcome => (outcome.ok ? [outcome.group] : [])),
      unavailable: outcomes.flatMap(outcome =>
        outcome.ok ? [] : [outcome.unavailable],
      ),
    });
  };
};
