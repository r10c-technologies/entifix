import {
  type EntifixFailure,
  type FailureCategory,
  Internal,
  isFailure,
  PROBLEM_CONTENT_TYPE,
  problemOf,
} from '@entifix/core';
import { Cause, Effect, Option } from 'effect';
import type { HttpBody } from 'effect/http';
import { HttpRouter, HttpServerRequest, HttpServerResponse } from 'effect/http';
import type { Severity } from 'effect/LogLevel';

/**
 * What a mounted handler may fail with: a categorised failure, or the
 * response body failing to encode. Anything else — a plain `Error`, a string —
 * does not compile at the mount, which is the point: a failure the shell cannot
 * categorise is one it cannot answer honestly
 * ([ADR 0013](../../../../docs/adr/0013-failures-are-typed-values-decided-at-the-shell.md)).
 */
export type RouteFailure = EntifixFailure | HttpBody.HttpBodyError;

/**
 * How a host answers and logs its failures: the status a category answers with
 * and the level it is logged at, each overridable per tag.
 *
 * The composition root owns it. A cell never decides a status, a retry or a
 * log line; it fails, and the shell's policy says what that means.
 */
export interface FailurePolicy {
  readonly categoryStatus: Readonly<Record<FailureCategory, number>>;
  readonly tagStatus: Readonly<Record<string, number>>;
  readonly categoryLogLevel: Readonly<Record<FailureCategory, Severity>>;
  readonly tagLogLevel: Readonly<Record<string, Severity>>;
}

/**
 * The defaults: the category table's statuses, business failures at `Debug`
 * because an answer is not an incident, the transient technical categories at
 * `Warn`, and what is broken — a peer speaking nonsense, a bug — at `Error`.
 */
export const defaultFailurePolicy: FailurePolicy = {
  categoryStatus: {
    invalid: 400,
    unauthenticated: 401,
    forbidden: 403,
    notFound: 404,
    conflict: 409,
    declined: 422,
    contention: 409,
    exhausted: 429,
    unavailable: 503,
    timeout: 504,
    protocol: 502,
    internal: 500,
  },
  tagStatus: {},
  categoryLogLevel: {
    invalid: 'Debug',
    unauthenticated: 'Debug',
    forbidden: 'Debug',
    notFound: 'Debug',
    conflict: 'Debug',
    declined: 'Debug',
    contention: 'Warn',
    exhausted: 'Warn',
    unavailable: 'Warn',
    timeout: 'Warn',
    protocol: 'Error',
    internal: 'Error',
  },
  tagLogLevel: {},
};

export interface FailurePolicyOverrides {
  readonly categoryStatus?: Partial<Record<FailureCategory, number>>;
  readonly tagStatus?: Readonly<Record<string, number>>;
  readonly categoryLogLevel?: Partial<Record<FailureCategory, Severity>>;
  readonly tagLogLevel?: Readonly<Record<string, Severity>>;
}

/** A policy with some of its entries replaced — how a slice extends the fleet's. */
export const extendFailurePolicy = (
  base: FailurePolicy,
  overrides: FailurePolicyOverrides,
): FailurePolicy => ({
  categoryStatus: { ...base.categoryStatus, ...overrides.categoryStatus },
  tagStatus: { ...base.tagStatus, ...overrides.tagStatus },
  categoryLogLevel: {
    ...base.categoryLogLevel,
    ...overrides.categoryLogLevel,
  },
  tagLogLevel: { ...base.tagLogLevel, ...overrides.tagLogLevel },
});

export const statusFor = (
  failure: EntifixFailure,
  policy: FailurePolicy,
): number =>
  policy.tagStatus[failure._tag] ?? policy.categoryStatus[failure.category];

export const logLevelFor = (
  failure: EntifixFailure,
  policy: FailurePolicy,
): Severity =>
  policy.tagLogLevel[failure._tag] ?? policy.categoryLogLevel[failure.category];

export interface ProblemResponseOptions {
  readonly traceId?: string | undefined;
  readonly instance?: string | undefined;
}

const retryAfterOf = (failure: EntifixFailure): number | undefined => {
  const seconds = (failure as { readonly retryAfterSeconds?: unknown })
    .retryAfterSeconds;
  return typeof seconds === 'number' ? seconds : undefined;
};

/**
 * The `application/problem+json` answer to a failure, with the policy's
 * status. Built synchronously — the body is already plain data — so it cannot
 * itself fail to encode.
 */
export const problemResponse = (
  failure: EntifixFailure,
  policy: FailurePolicy = defaultFailurePolicy,
  options: ProblemResponseOptions = {},
): HttpServerResponse.HttpServerResponse => {
  const status = statusFor(failure, policy);
  const retryAfter = retryAfterOf(failure);
  return HttpServerResponse.text(
    JSON.stringify(
      problemOf(failure, {
        status,
        ...(options.traceId === undefined ? {} : { traceId: options.traceId }),
        ...(options.instance === undefined
          ? {}
          : { instance: options.instance }),
      }),
    ),
    {
      status,
      contentType: PROBLEM_CONTENT_TYPE,
      ...(retryAfter === undefined
        ? {}
        : { headers: { 'retry-after': String(retryAfter) } }),
    },
  );
};

/** The current span's trace id, when a span is open. */
const currentTraceId: Effect.Effect<string | undefined> = Effect.option(
  Effect.currentSpan,
).pipe(
  Effect.map(span => Option.getOrUndefined(Option.map(span, s => s.traceId))),
);

/** The path being answered, when a request is in scope. */
const currentInstance: Effect.Effect<string | undefined> = Effect.serviceOption(
  HttpServerRequest.HttpServerRequest,
).pipe(
  Effect.map(request =>
    Option.getOrUndefined(Option.map(request, r => r.url.split('?')[0])),
  ),
);

const answerFailure = (failure: EntifixFailure, policy: FailurePolicy) =>
  Effect.gen(function* () {
    const traceId = yield* currentTraceId;
    const instance = yield* currentInstance;
    yield* Effect.logWithLevel(logLevelFor(failure, policy))(
      'request failed',
    ).pipe(
      Effect.annotateLogs({
        code: failure.code,
        category: failure.category,
        tag: failure._tag,
        ...(traceId === undefined ? {} : { traceId }),
      }),
    );
    return problemResponse(failure, policy, { traceId, instance });
  });

/**
 * The opaque `500` for anything nobody categorised. The defect is logged in
 * full here, where it was caught; the body carries the trace id to find that
 * line by, and nothing of the defect itself.
 */
const answerDefect = (defect: unknown) =>
  Effect.gen(function* () {
    const traceId = yield* currentTraceId;
    const instance = yield* currentInstance;
    yield* Effect.logError('request defect').pipe(
      Effect.annotateLogs({
        code: 'internal',
        category: 'internal',
        cause: Cause.pretty(Cause.die(defect)),
        ...(traceId === undefined ? {} : { traceId }),
      }),
    );
    return problemResponse(new Internal(), defaultFailurePolicy, {
      traceId,
      instance,
    });
  });

/**
 * The terminal reaction: every failure answered as a problem body with the
 * policy's status and logged at the policy's level, every defect answered as
 * an opaque `500`. Interruption is left alone — a request whose client went
 * away has nobody to answer.
 */
export const respond = <E extends RouteFailure, R>(
  effect: Effect.Effect<HttpServerResponse.HttpServerResponse, E, R>,
  policy: FailurePolicy = defaultFailurePolicy,
): Effect.Effect<HttpServerResponse.HttpServerResponse, never, R> =>
  effect.pipe(
    Effect.catch((failure: E) =>
      isFailure(failure)
        ? answerFailure(failure, policy)
        : answerDefect(failure),
    ),
    Effect.catchDefect(answerDefect),
  );

/**
 * Mounts a set of routes with every handler wrapped in {@link respond}, once,
 * at the composition root. A route whose handler fails with anything but a
 * {@link RouteFailure} does not compile here.
 */
export const mountRoutes = <
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const Routes extends ReadonlyArray<HttpRouter.Route<RouteFailure, any>>,
>(
  routes: Routes,
  policy: FailurePolicy = defaultFailurePolicy,
) =>
  HttpRouter.addAll(
    routes.map(route =>
      HttpRouter.route(
        route.method,
        route.path,
        respond(route.handler, policy),
        {
          uninterruptible: route.uninterruptible,
        },
      ),
    ) as unknown as {
      readonly [K in keyof Routes]: HttpRouter.Route<
        never,
        HttpRouter.Route.Context<Routes[K]>
      >;
    },
  );

/**
 * The router's last net: a defect that escaped every route — one not mounted
 * through {@link mountRoutes}, or one thrown while a response was being
 * written — answers the same opaque `500` problem. It catches defects only,
 * never the whole cause, so an interruption still interrupts.
 */
export const problemNet = HttpRouter.middleware(
  effect => effect.pipe(Effect.catchDefect(answerDefect)),
  { global: true },
);
