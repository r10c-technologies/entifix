import {
  type AnyEndpoint,
  currentRemainingMs,
  DEADLINE_HEADER,
  type DeclaredFailure,
  decodeProblem,
  type EndpointRequest,
  type EndpointSchema,
  type EndpointSuccess,
  type EntifixFailure,
  formatIdempotencyKey,
  IDEMPOTENCY_KEY_HEADER,
  Overloaded,
  PROBLEM_CONTENT_TYPE,
  ProtocolFailure,
  type TechnicalFailure,
  Timeout,
  Unavailable,
} from '@entifix/core';
import { Effect, Schema } from 'effect';
import {
  HttpClient,
  HttpClientRequest,
  type HttpClientResponse,
} from 'effect/http';

/**
 * A refusal any guarded endpoint may answer without declaring it: the caller
 * is not signed in, may not, or sent something the endpoint cannot read.
 */
export type GuardFailure = EntifixFailure<
  string,
  string,
  'unauthenticated' | 'forbidden' | 'invalid'
>;

/** Everything a call may fail with: what it declares, and what any call may. */
export type EndpointCallFailure<D> =
  DeclaredFailure<D> | GuardFailure | TechnicalFailure;

/** What a caller sends: the endpoint's decoded parts, and its key when idempotent. */
export type EndpointCallRequest<D> = EndpointRequest<D> &
  (D extends { readonly idempotent?: infer Mode }
    ? [NonNullable<Mode>] extends [never]
      ? unknown
      : { readonly idempotencyKey: string }
    : unknown);

/** One call per endpoint, by its name. */
export type EndpointClient<Endpoints extends ReadonlyArray<AnyEndpoint>> = {
  readonly [D in Endpoints[number] as D['name']]: (
    request: EndpointCallRequest<D>,
  ) => Effect.Effect<
    EndpointSuccess<D>,
    EndpointCallFailure<D>,
    HttpClient.HttpClient
  >;
};

export interface EndpointClientOptions {
  /** The origin and any prefix the endpoints' paths are joined to. */
  readonly baseUrl: string;
  /**
   * Shapes the client before each call — forwarding a cookie from a Next
   * server component, or adding a crossing token for a participant call.
   */
  readonly transformClient?: (
    client: HttpClient.HttpClient,
  ) => HttpClient.HttpClient;
}

const toSchema = (schema: EndpointSchema): Schema.Top =>
  Schema.isSchema(schema) ? schema : Schema.Struct(schema);

const encode = (schema: EndpointSchema | undefined, value: unknown) =>
  schema === undefined
    ? Effect.succeed(undefined)
    : Schema.encodeUnknownEffect(
        toSchema(schema) as Schema.Codec<unknown, unknown>,
      )(value).pipe(
        Effect.mapError(
          error =>
            new ProtocolFailure({
              reason: `the request does not encode: ${error.message}`,
            }),
        ),
      );

/**
 * The path with every `:param` replaced by its encoded value. A path that
 * names a parameter is one whose descriptor declares it, so the encoded
 * params carry every name the path does.
 */
const pathOf = (path: string, params: unknown): string =>
  path.replace(/:([A-Za-z0-9_]+)/g, (_match, name: string) =>
    encodeURIComponent(String((params as Record<string, unknown>)[name])),
  );

const queryOf = (query: unknown): Record<string, string | string[]> =>
  Object.fromEntries(
    Object.entries((query ?? {}) as Record<string, unknown>)
      .filter(([, value]) => value !== undefined)
      .map(([key, value]) => [
        key,
        Array.isArray(value) ? value.map(String) : String(value),
      ]),
  );

const ALWAYS: ReadonlySet<string> = new Set([
  'unauthenticated',
  'forbidden',
  'invalid',
]);

/**
 * The failure a response names, decoded by its `code` against what the
 * endpoint may answer — never by its status, which is the shell's to choose.
 * A business failure the endpoint does not declare, a code nobody registered
 * and a body that is not a problem are all `protocol`: the peer said something
 * this contract does not admit.
 */
const failureOf = (
  descriptor: AnyEndpoint,
  response: HttpClientResponse.HttpClientResponse,
) =>
  Effect.gen(function* () {
    const text = yield* response.text.pipe(Effect.orElseSucceed(() => ''));
    const isProblem =
      response.headers['content-type']?.startsWith(PROBLEM_CONTENT_TYPE) ===
      true;
    if (!isProblem)
      return new ProtocolFailure({
        reason: `${descriptor.method} ${descriptor.path} answered ${String(response.status)} without a problem body`,
        upstreamStatus: response.status,
      }) as EntifixFailure;

    const failure = decodeProblem(parse(text), response.status);
    const declared = descriptor.errors.some(
      failureClass => failureClass.identifier === failure._tag,
    );
    if (
      failure.family === 'business' &&
      !declared &&
      !ALWAYS.has(failure.category)
    )
      return new ProtocolFailure({
        reason: `${descriptor.method} ${descriptor.path} answered '${failure.code}', which it does not declare`,
        upstreamStatus: response.status,
      });

    const retryAfter = Number(response.headers['retry-after']);
    return failure._tag === 'Overloaded' &&
      !('retryAfterSeconds' in failure) &&
      Number.isFinite(retryAfter) &&
      retryAfter > 0
      ? new Overloaded({ retryAfterSeconds: retryAfter })
      : failure;
  });

const parse = (text: string): unknown => {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
};

const call = (
  descriptor: AnyEndpoint,
  options: EndpointClientOptions,
  request: Record<string, unknown>,
) =>
  Effect.gen(function* () {
    // The caller's remaining budget travels on, and a budget already spent is
    // not worth a round trip.
    const remaining = yield* currentRemainingMs;
    if (remaining === 0)
      return yield* Effect.fail(
        new Timeout({ dependency: `${descriptor.method} ${descriptor.path}` }),
      );

    const params = yield* encode(descriptor.params, request['params']);
    const query = yield* encode(descriptor.query, request['query']);
    const payload = yield* encode(descriptor.payload, request['payload']);

    let outgoing = HttpClientRequest.make(descriptor.method)(
      `${options.baseUrl}${pathOf(descriptor.path, params)}`,
    ).pipe(
      HttpClientRequest.setUrlParams(queryOf(query)),
      HttpClientRequest.setHeader('accept', 'application/json'),
    );
    if (descriptor.payload !== undefined)
      outgoing = HttpClientRequest.bodyText(
        outgoing,
        JSON.stringify(payload),
        'application/json',
      );
    if (descriptor.idempotent !== undefined)
      outgoing = HttpClientRequest.setHeader(
        outgoing,
        IDEMPOTENCY_KEY_HEADER,
        formatIdempotencyKey(request['idempotencyKey'] as string),
      );
    if (remaining !== undefined)
      outgoing = HttpClientRequest.setHeader(
        outgoing,
        DEADLINE_HEADER,
        String(remaining),
      );

    const base = yield* HttpClient.HttpClient;
    const client = options.transformClient?.(base) ?? base;
    const response = yield* client.execute(outgoing).pipe(
      Effect.mapError(
        () =>
          new Unavailable({
            dependency: `${descriptor.method} ${descriptor.path}`,
          }),
      ),
    );

    if (response.status >= 400)
      return yield* Effect.fail(yield* failureOf(descriptor, response));

    const text = yield* response.text.pipe(
      Effect.mapError(
        () =>
          new Unavailable({
            dependency: `${descriptor.method} ${descriptor.path}`,
          }),
      ),
    );
    return yield* Schema.decodeUnknownEffect(
      descriptor.success as Schema.Codec<unknown, unknown>,
    )(text === '' ? undefined : parse(text)).pipe(
      Effect.mapError(
        error =>
          new ProtocolFailure({
            reason: `${descriptor.method} ${descriptor.path} answered a body that does not decode: ${error.message}`,
            upstreamStatus: response.status,
          }),
      ),
    );
  });

/**
 * A typed client over a set of endpoint descriptors
 * ([ADR 0020](../../../../../docs/adr/0020-endpoints-are-descriptors-and-the-shell-builds-an-httpapi.md)):
 * one call per endpoint, by name, typed from its descriptor. It runs wherever
 * an `HttpClient` does — `FetchHttpClient` in a browser, a Next server with a
 * forwarded cookie, an Effect service calling a participant — and needs
 * nothing of the shell that serves the endpoints, its status table included.
 */
export const makeEndpointClient = <
  const Endpoints extends ReadonlyArray<AnyEndpoint>,
>(
  endpoints: Endpoints,
  options: EndpointClientOptions,
): EndpointClient<Endpoints> =>
  Object.fromEntries(
    endpoints.map(descriptor => [
      descriptor.name,
      (request: Record<string, unknown>) => call(descriptor, options, request),
    ]),
  ) as unknown as EndpointClient<Endpoints>;
