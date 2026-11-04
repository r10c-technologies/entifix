import {
  DEADLINE_HEADER,
  DeadlineTag,
  Declined,
  IDEMPOTENCY_KEY_HEADER,
  PROBLEM_CONTENT_TYPE,
  problemOf,
} from '@entifix/core';
import {
  type ParticipantCall,
  ParticipantClientTag,
} from '@entifix/transactions';
import { Effect, Layer, Redacted } from 'effect';
import {
  HttpClient,
  HttpClientError,
  type HttpClientRequest,
  HttpClientResponse,
} from 'effect/http';
import { describe, expect, it } from 'vitest';

import {
  HttpParticipantClientLayer,
  makeHttpParticipantClient,
} from './participant-client.js';

interface Sent {
  readonly method: string;
  readonly url: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: string | undefined;
}

const fakeClient = (
  respond: (request: HttpClientRequest.HttpClientRequest) => Response,
  sent: Sent[] = [],
) =>
  HttpClient.make(request =>
    Effect.sync(() => {
      sent.push({
        method: request.method,
        url: request.url,
        headers: request.headers as Record<string, string>,
        body:
          request.body._tag === 'Uint8Array'
            ? new TextDecoder().decode(request.body.body)
            : undefined,
      });
      return HttpClientResponse.fromWeb(request, respond(request));
    }),
  );

const participants = {
  stock: {
    baseUrl: 'http://stock',
    crossingToken: Redacted.make('crossing-secret'),
  },
};

type SlipStep = ParticipantCall['step'];

const hold: SlipStep = {
  ref: 'stock.hold@1',
  step: 'v1:hold',
  cardinality: 'perVendor',
  participant: 'stock',
  call: { method: 'POST', path: '/api/reservation' },
  compensation: { method: 'DELETE', path: '/api/reservation/:hold' },
  parameters: { organizationId: 'org-1', quantity: 2 },
};

const callOf = (overrides: Partial<ParticipantCall> = {}): ParticipantCall => ({
  step: hold,
  kind: 'action',
  idempotencyKey: 'flow-1:v1:hold',
  inputs: hold.parameters ?? {},
  ...overrides,
});

const run = <A, E>(effect: Effect.Effect<A, E>) =>
  Effect.runPromise(Effect.result(effect));

describe('makeHttpParticipantClient', () => {
  it('sends the crossing token, the key, the organization and the call’s inputs as a flat body', async () => {
    const sent: Sent[] = [];
    const client = makeHttpParticipantClient(
      fakeClient(() => Response.json({ id: 'h-1' }), sent),
      participants,
    );

    const result = await run(
      client.call(callOf({ inputs: { ...hold.parameters, pickId: 'p-1' } })),
    );

    expect(result).toMatchObject({ success: { id: 'h-1' } });
    expect(sent[0]).toMatchObject({
      method: 'POST',
      url: 'http://stock/api/reservation',
      body: JSON.stringify({
        organizationId: 'org-1',
        quantity: 2,
        pickId: 'p-1',
      }),
    });
    expect(sent[0]?.headers).toMatchObject({
      'x-crossing-token': 'crossing-secret',
      'x-organization-id': 'org-1',
      [IDEMPOTENCY_KEY_HEADER]: '"flow-1:v1:hold"',
    });
    expect(sent[0]?.headers[DEADLINE_HEADER]).toBeUndefined();
  });

  it('takes a path’s parameter from the inputs, and an empty body as nothing', async () => {
    const sent: Sent[] = [];
    const client = makeHttpParticipantClient(
      fakeClient(() => new Response(null, { status: 204 }), sent),
      participants,
    );

    const result = await run(
      client.call(callOf({ kind: 'compensation', inputs: { hold: 'h 1' } })),
    );

    expect(result).toMatchObject({ _tag: 'Success', success: undefined });
    expect(sent[0]).toMatchObject({
      method: 'DELETE',
      url: 'http://stock/api/reservation/h%201',
    });
    expect(sent[0]?.headers['x-organization-id']).toBeUndefined();
  });

  it('leaves a name nothing supplies empty, and sends no body on a GET', async () => {
    const sent: Sent[] = [];
    const client = makeHttpParticipantClient(
      fakeClient(() => new Response('not json'), sent),
      participants,
    );

    const missing = await run(
      client.call(callOf({ kind: 'compensation', inputs: {} })),
    );
    await run(
      client.call(
        callOf({
          step: {
            ...hold,
            call: { method: 'GET', path: '/api/reservation/:hold' },
          },
          inputs: { hold: 'h-2' },
        }),
      ),
    );

    expect(missing).toMatchObject({ _tag: 'Success', success: undefined });
    expect(sent.map(request => request.url)).toEqual([
      'http://stock/api/reservation/',
      'http://stock/api/reservation/h-2',
    ]);
    expect(sent[0]?.body).toBe('{}');
    expect(sent[1]?.body).toBeUndefined();
  });

  it('answers at once for a step with no call', async () => {
    const sent: Sent[] = [];
    const client = makeHttpParticipantClient(
      fakeClient(() => Response.json({}), sent),
      participants,
    );
    const noUndo: SlipStep = { ...hold, compensation: undefined } as never;

    const result = await run(
      client.call(callOf({ kind: 'compensation', step: noUndo })),
    );

    expect(result).toMatchObject({ _tag: 'Success', success: undefined });
    expect(sent).toHaveLength(0);
  });

  it('refuses a participant it has no address for, as internal', async () => {
    const client = makeHttpParticipantClient(
      fakeClient(() => Response.json({})),
      participants,
    );
    const nobody: SlipStep = { ...hold, participant: undefined } as never;

    const unnamed = await run(client.call(callOf({ step: nobody })));
    const unknown = await run(
      client.call(callOf({ step: { ...hold, participant: 'payment' } })),
    );

    expect(unnamed).toMatchObject({ failure: { _tag: 'Internal' } });
    expect(unknown).toMatchObject({ failure: { _tag: 'Internal' } });
  });

  it('passes the flow’s remaining budget on, and fails a spent one without calling', async () => {
    const sent: Sent[] = [];
    const client = makeHttpParticipantClient(
      fakeClient(() => Response.json({}), sent),
      participants,
    );

    await run(
      client.call(callOf()).pipe(
        Effect.provideService(DeadlineTag, {
          expiresAt: Date.now() + 60_000,
        }),
      ),
    );
    const spent = await run(
      client
        .call(callOf())
        .pipe(
          Effect.provideService(DeadlineTag, { expiresAt: Date.now() - 1 }),
        ),
    );

    expect(Number(sent[0]?.headers[DEADLINE_HEADER])).toBeGreaterThan(0);
    expect(spent).toMatchObject({ failure: { _tag: 'Timeout' } });
    expect(sent).toHaveLength(1);
  });

  it('decodes a refusal by its code, and a non-problem error as protocol', async () => {
    const refusing = makeHttpParticipantClient(
      fakeClient(
        () =>
          new Response(
            JSON.stringify(problemOf(new Declined({}), { status: 402 })),
            {
              status: 402,
              headers: { 'content-type': PROBLEM_CONTENT_TYPE },
            },
          ),
      ),
      participants,
    );
    const garbled = makeHttpParticipantClient(
      fakeClient(() => new Response('<html>', { status: 502 })),
      participants,
    );

    expect(await run(refusing.call(callOf()))).toMatchObject({
      failure: { code: 'declined' },
    });
    expect(await run(garbled.call(callOf()))).toMatchObject({
      failure: { _tag: 'ProtocolFailure', upstreamStatus: 502 },
    });
  });

  it('answers unavailable when the call or its body cannot be read', async () => {
    const broken = makeHttpParticipantClient(
      HttpClient.make(request =>
        Effect.fail(
          new HttpClientError.HttpClientError({
            reason: new HttpClientError.TransportError({ request }),
          }),
        ),
      ),
      participants,
    );
    const torn = makeHttpParticipantClient(
      fakeClient(
        () =>
          new Response(
            new ReadableStream({
              start: controller => controller.error(new Error('torn')),
            }),
          ),
      ),
      participants,
    );

    expect(await run(broken.call(callOf()))).toMatchObject({
      failure: {
        _tag: 'Unavailable',
        dependency: 'stock POST /api/reservation',
      },
    });
    expect(await run(torn.call(callOf()))).toMatchObject({
      failure: { _tag: 'Unavailable' },
    });
  });

  it('is provided as the participant client over the host’s HttpClient', async () => {
    const layer = HttpParticipantClientLayer(participants).pipe(
      Layer.provide(
        Layer.succeed(
          HttpClient.HttpClient,
          fakeClient(() => Response.json({ ok: true })),
        ),
      ),
    );

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const client = yield* ParticipantClientTag;
        return yield* client.call(callOf());
      }).pipe(Effect.provide(layer)),
    );

    expect(result).toEqual({ ok: true });
  });
});
