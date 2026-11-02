import {
  DEADLINE_HEADER,
  DeadlineTag,
  defineEndpoint,
  Failure,
  IDEMPOTENCY_KEY_HEADER,
  PROBLEM_CONTENT_TYPE,
  problemOf,
  Unauthenticated,
} from '@entifix/core';
import { Effect, Schema } from 'effect';
import {
  HttpClient,
  HttpClientError,
  type HttpClientRequest,
  HttpClientResponse,
} from 'effect/http';
import { describe, expect, it } from 'vitest';

import { makeEndpointClient } from './endpoint-client.js';

class Taken extends Failure.conflict<Taken>()(
  'SpecClientTaken',
  'specClientTaken',
  {
    slug: Schema.String,
  },
) {}

class Stranger extends Failure.conflict<Stranger>()(
  'SpecClientStranger',
  'specClientStranger',
) {}

const claim = defineEndpoint({
  name: 'claim',
  method: 'POST',
  path: '/api/slug/:slug',
  params: { slug: Schema.String },
  query: {
    times: Schema.optional(Schema.FiniteFromString),
    tag: Schema.optional(Schema.Array(Schema.String)),
  },
  payload: Schema.Struct({ note: Schema.String }),
  success: Schema.Struct({ slug: Schema.String }),
  errors: [Taken],
  guard: { kind: 'public' },
  idempotent: 'unit',
});

const ping = defineEndpoint({
  name: 'ping',
  method: 'GET',
  path: '/api/ping',
  success: Schema.String,
  errors: [],
  guard: { kind: 'public' },
});

interface Sent {
  readonly method: string;
  readonly url: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: string | undefined;
}

/** An `HttpClient` that records what it was sent and answers `respond`. */
const fakeClient = (
  respond: (request: HttpClientRequest.HttpClientRequest) => Response,
  sent: Sent[] = [],
) =>
  HttpClient.make(request =>
    Effect.sync(() => {
      sent.push({
        method: request.method,
        url:
          request.url +
          (request.urlParams.params.length > 0
            ? `?${new URLSearchParams(request.urlParams.params as [string, string][]).toString()}`
            : ''),
        headers: request.headers as Record<string, string>,
        body:
          request.body._tag === 'Uint8Array'
            ? new TextDecoder().decode(request.body.body)
            : undefined,
      });
      return HttpClientResponse.fromWeb(request, respond(request));
    }),
  );

const problem = (
  failure: Parameters<typeof problemOf>[0],
  status: number,
  headers = {},
) =>
  new Response(JSON.stringify(problemOf(failure, { status })), {
    status,
    headers: { 'content-type': PROBLEM_CONTENT_TYPE, ...headers },
  });

const run = <A, E>(
  effect: Effect.Effect<A, E, HttpClient.HttpClient>,
  client: HttpClient.HttpClient,
) =>
  Effect.runPromise(
    Effect.result(Effect.provideService(effect, HttpClient.HttpClient, client)),
  );

const api = makeEndpointClient([claim, ping], { baseUrl: 'http://svc' });

describe('makeEndpointClient', () => {
  it('sends the encoded path, query, body and key, and decodes the answer', async () => {
    const sent: Sent[] = [];
    const client = fakeClient(() => Response.json({ slug: 'a b' }), sent);

    const result = await run(
      api.claim({
        params: { slug: 'a b' },
        query: { times: 2, tag: ['x', 'y'] },
        payload: { note: 'hi' },
        idempotencyKey: 'flow-1:claim',
      }),
      client,
    );

    expect(result).toMatchObject({ _tag: 'Success', success: { slug: 'a b' } });
    expect(sent[0]).toMatchObject({
      method: 'POST',
      url: 'http://svc/api/slug/a%20b?times=2&tag=x&tag=y',
      body: '{"note":"hi"}',
    });
    expect(sent[0]?.headers[IDEMPOTENCY_KEY_HEADER]).toBe('"flow-1:claim"');
  });

  it('decodes a declared failure by its code, whatever the status', async () => {
    const client = fakeClient(() => problem(new Taken({ slug: 'a' }), 418));

    const result = await run(
      api.claim({
        params: { slug: 'a' },
        query: {},
        payload: { note: '' },
        idempotencyKey: 'k',
      }),
      client,
    );

    expect(result).toMatchObject({
      _tag: 'Failure',
      failure: { _tag: 'SpecClientTaken', slug: 'a' },
    });
  });

  it('passes a guard refusal and a technical failure through', async () => {
    const unauthenticated = await run(
      api.ping({} as never),
      fakeClient(() => problem(new Unauthenticated(), 401)),
    );
    const overloaded = await run(
      api.ping({} as never),
      fakeClient(
        () =>
          new Response(
            JSON.stringify({
              type: 'urn:entifix:failure:overloaded',
              title: 'Overloaded',
              status: 429,
              code: 'overloaded',
              category: 'exhausted',
            }),
            {
              status: 429,
              headers: {
                'content-type': PROBLEM_CONTENT_TYPE,
                'retry-after': '7',
              },
            },
          ),
      ),
    );

    expect(unauthenticated).toMatchObject({
      failure: { _tag: 'Unauthenticated' },
    });
    expect(overloaded).toMatchObject({
      failure: { _tag: 'Overloaded', retryAfterSeconds: 7 },
    });
  });

  it('reads an undeclared business failure as a protocol failure', async () => {
    const result = await run(
      api.ping({} as never),
      fakeClient(() => problem(new Stranger(), 409)),
    );

    expect(result).toMatchObject({
      failure: { _tag: 'ProtocolFailure', upstreamStatus: 409 },
    });
  });

  it('reads a body that is not a problem as a protocol failure', async () => {
    const result = await run(
      api.ping({} as never),
      fakeClient(
        () =>
          new Response('<html>bad gateway</html>', {
            status: 502,
            headers: { 'content-type': 'text/html' },
          }),
      ),
    );

    expect(result).toMatchObject({
      failure: { _tag: 'ProtocolFailure', upstreamStatus: 502 },
    });
  });

  it('reads a success that does not decode as a protocol failure', async () => {
    const result = await run(
      api.ping({} as never),
      fakeClient(() => Response.json(42)),
    );
    const empty = await run(
      api.ping({} as never),
      fakeClient(() => new Response('', { status: 200 })),
    );

    expect(result).toMatchObject({ failure: { _tag: 'ProtocolFailure' } });
    expect(empty).toMatchObject({ failure: { _tag: 'ProtocolFailure' } });
  });

  it('refuses a request that does not encode', async () => {
    const result = await run(
      api.claim({
        params: { slug: 'a' },
        query: {},
        payload: { note: 7 as unknown as string },
        idempotencyKey: 'k',
      }),
      fakeClient(() => Response.json({ slug: 'a' })),
    );

    expect(result).toMatchObject({ failure: { _tag: 'ProtocolFailure' } });
  });

  it('forwards what is left of the deadline, and makes no call past it', async () => {
    const sent: Sent[] = [];
    const client = fakeClient(() => Response.json('pong'), sent);
    const far = { expiresAt: Date.now() + 60_000 };
    const past = { expiresAt: Date.now() - 1 };

    await run(
      api.ping({} as never).pipe(Effect.provideService(DeadlineTag, far)),
      client,
    );
    const expired = await run(
      api.ping({} as never).pipe(Effect.provideService(DeadlineTag, past)),
      client,
    );

    expect(Number(sent[0]?.headers[DEADLINE_HEADER])).toBeGreaterThan(0);
    expect(expired).toMatchObject({ failure: { _tag: 'Timeout' } });
    expect(sent).toHaveLength(1);
  });

  it('answers unavailable when the transport fails', async () => {
    const broken = HttpClient.make(request =>
      Effect.fail(
        new HttpClientError.HttpClientError({
          reason: new HttpClientError.TransportError({ request }),
        }),
      ),
    );

    const result = await run(api.ping({} as never), broken);

    expect(result).toMatchObject({ failure: { _tag: 'Unavailable' } });
  });

  it('lets the host shape the client before each call', async () => {
    const sent: Sent[] = [];
    const shaped = makeEndpointClient([ping], {
      baseUrl: 'http://svc',
      transformClient: client =>
        HttpClient.mapRequest(
          client,
          request =>
            ({
              ...request,
              headers: { ...request.headers, cookie: 'entifix_at=t' },
            }) as never,
        ),
    });

    await run(
      shaped.ping({} as never),
      fakeClient(() => Response.json('pong'), sent),
    );

    expect(sent[0]?.headers['cookie']).toBe('entifix_at=t');
  });

  it('reads a problem body that is not JSON as a protocol failure', async () => {
    const result = await run(
      api.ping({} as never),
      fakeClient(
        () =>
          new Response('{not json', {
            status: 409,
            headers: { 'content-type': PROBLEM_CONTENT_TYPE },
          }),
      ),
    );

    expect(result).toMatchObject({ failure: { _tag: 'ProtocolFailure' } });
  });

  it('answers unavailable when the body cannot be read', async () => {
    const broken = () =>
      new Response(
        new ReadableStream({
          start: controller => controller.error(new Error('reset')),
        }),
        { status: 200 },
      );
    const brokenProblem = () =>
      new Response(
        new ReadableStream({
          start: controller => controller.error(new Error('reset')),
        }),
        { status: 409, headers: { 'content-type': PROBLEM_CONTENT_TYPE } },
      );

    expect(await run(api.ping({} as never), fakeClient(broken))).toMatchObject({
      failure: { _tag: 'Unavailable' },
    });
    expect(
      await run(api.ping({} as never), fakeClient(brokenProblem)),
    ).toMatchObject({ failure: { _tag: 'ProtocolFailure' } });
  });
});
