import { makeStaticPolicyDecision, PolicyDecisionTag } from '@entifix/authz';
import { InvalidToken, TokenServiceTag } from '@entifix/business';
import {
  binaryBody,
  binaryResponse,
  defineEndpoint,
  Failure,
  formBody,
  implement,
  textBody,
  Unavailable,
} from '@entifix/core';
import { makeEndpointClient } from '@entifix/rest/endpoint';
import { Effect, Layer, Schema } from 'effect';
import { FetchHttpClient } from 'effect/http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { defaultFailurePolicy, extendFailurePolicy } from '../respond.js';
import {
  type RunningTestService,
  serveTestService,
} from '../serve-test-service.js';
import { endpointGroup } from './build-api.js';

/*
 * The client and the shell, end to end: whatever status the shell chose, the
 * client decodes the failure that was sent, by its code.
 */

class SlotTaken extends Failure.conflict<SlotTaken>()(
  'SpecSlotTaken',
  'specSlotTaken',
  { slot: Schema.String },
) {}

class SlotLocked extends Failure.conflict<SlotLocked>()(
  'SpecSlotLocked',
  'specSlotLocked',
  { until: Schema.String },
) {}

class CardDeclined extends Failure.declined<CardDeclined>()(
  'SpecCardDeclined',
  'specCardDeclined',
  { reason: Schema.String },
) {}

const book = defineEndpoint({
  name: 'book',
  method: 'POST',
  path: '/api/slot/:slot',
  params: { slot: Schema.String },
  success: Schema.Struct({ booked: Schema.String }),
  errors: [SlotTaken, SlotLocked, CardDeclined],
  guard: { kind: 'public' },
});

const mine = defineEndpoint({
  name: 'mine',
  method: 'GET',
  path: '/api/mine',
  success: Schema.String,
  errors: [],
  guard: { kind: 'session' },
});

const upload = defineEndpoint({
  name: 'upload',
  method: 'POST',
  path: '/api/upload',
  payload: binaryBody({ contentTypes: ['image/png'], maxBytes: 4 }),
  success: Schema.Struct({ size: Schema.Number }),
  errors: [],
  guard: { kind: 'public' },
});

const fetchFile = defineEndpoint({
  name: 'fetchFile',
  method: 'GET',
  path: '/api/file',
  success: binaryResponse(),
  errors: [],
  guard: { kind: 'public' },
});

const echoText = defineEndpoint({
  name: 'echoText',
  method: 'POST',
  path: '/api/echo-text',
  payload: textBody(),
  success: Schema.String,
  errors: [],
  guard: { kind: 'public' },
});

const echoForm = defineEndpoint({
  name: 'echoForm',
  method: 'POST',
  path: '/api/echo-form',
  payload: formBody({ token: Schema.String }),
  success: Schema.String,
  errors: [],
  guard: { kind: 'public' },
});

const groups = [
  endpointGroup(
    'bodies',
    implement(upload, ({ payload }) =>
      Effect.succeed({ size: payload.bytes.length }),
    ),
    implement(fetchFile, () =>
      Effect.succeed({
        bytes: new Uint8Array([7, 8]),
        contentType: 'image/png',
        headers: { 'content-disposition': 'inline' },
      }),
    ),
    implement(echoText, ({ payload }) => Effect.succeed(payload)),
    implement(echoForm, ({ payload }) => Effect.succeed(payload.token)),
  ),
  endpointGroup(
    'slots',
    implement(book, ({ params }) => {
      switch (params.slot) {
        case 'taken':
          return Effect.fail(new SlotTaken({ slot: params.slot }));
        case 'locked':
          return Effect.fail(new SlotLocked({ until: 'noon' }));
        case 'declined':
          return Effect.fail(
            new CardDeclined({ reason: 'insufficient funds' }),
          );
        case 'down':
          return Effect.fail(new Unavailable({ dependency: 'calendar' }));
        default:
          return Effect.succeed({ booked: params.slot });
      }
    }),
    implement(mine, () => Effect.succeed('mine')),
  ),
] as const;

let service: RunningTestService;

beforeAll(async () => {
  service = await serveTestService({
    name: 'spec-roundtrip',
    port: 0,
    slices: ['test'],
    endpoints: groups,
    // The client never sees this table: a declined card answers 402 here.
    policy: extendFailurePolicy(defaultFailurePolicy, {
      tagStatus: { SpecCardDeclined: 402 },
    }),
    appLayer: Layer.mergeAll(
      Layer.succeed(TokenServiceTag, {
        sign: () => Effect.succeed('never'),
        verify: () => Effect.fail(new InvalidToken()),
      }),
      Layer.succeed(PolicyDecisionTag, makeStaticPolicyDecision({})),
    ),
  });
});

afterAll(async () => {
  await service.close();
});

const client = () =>
  makeEndpointClient([book, mine], { baseUrl: service.baseUrl });

const call = <A, E>(effect: Effect.Effect<A, E, never>) =>
  Effect.runPromise(Effect.result(effect));

const booking = (slot: string) =>
  call(
    client()
      .book({ params: { slot } })
      .pipe(Effect.provide(FetchHttpClient.layer)),
  );

describe('the endpoint client against the shell', () => {
  it('decodes a success', async () => {
    expect(await booking('nine')).toMatchObject({
      _tag: 'Success',
      success: { booked: 'nine' },
    });
  });

  it('tells two failures that share a status apart, with their fields', async () => {
    expect(await booking('taken')).toMatchObject({
      failure: { _tag: 'SpecSlotTaken', slot: 'taken' },
    });
    expect(await booking('locked')).toMatchObject({
      failure: { _tag: 'SpecSlotLocked', until: 'noon' },
    });
  });

  it('decodes a failure under a status override it never saw', async () => {
    expect(await booking('declined')).toMatchObject({
      failure: { _tag: 'SpecCardDeclined', reason: 'insufficient funds' },
    });
  });

  it('decodes a technical failure and a guard refusal', async () => {
    expect(await booking('down')).toMatchObject({
      failure: { _tag: 'Unavailable', dependency: 'calendar' },
    });
    expect(
      await call(
        client()
          .mine({} as never)
          .pipe(Effect.provide(FetchHttpClient.layer)),
      ),
    ).toMatchObject({ failure: { _tag: 'Unauthenticated' } });
  });
});

describe('the endpoint client with bodies that are not JSON', () => {
  const bodies = () =>
    makeEndpointClient([upload, fetchFile, echoText, echoForm], {
      baseUrl: service.baseUrl,
    });
  const run = <A, E>(effect: Effect.Effect<A, E, never>) =>
    call(effect.pipe(Effect.provide(FetchHttpClient.layer)) as never);

  it('sends raw bytes under the media type it was given', async () => {
    const result = await run(
      bodies().upload({
        payload: { bytes: new Uint8Array([1, 2, 3]), contentType: 'image/png' },
      }) as never,
    );

    expect(result).toMatchObject({ _tag: 'Success', success: { size: 3 } });
  });

  it('decodes the refusal of a body past the limit', async () => {
    const result = await run(
      bodies().upload({
        payload: { bytes: new Uint8Array(5), contentType: 'image/png' },
      }) as never,
    );

    expect(result).toMatchObject({
      _tag: 'Failure',
      failure: { _tag: 'PayloadTooLarge', maxBytes: 4 },
    });
  });

  it('answers the bytes, their type and the headers beside them', async () => {
    const result = (await run(bodies().fetchFile({}) as never)) as {
      readonly success: {
        readonly bytes: Uint8Array;
        readonly contentType: string;
        readonly headers: Record<string, string>;
      };
    };

    expect(result.success.bytes).toEqual(new Uint8Array([7, 8]));
    expect(result.success.contentType).toBe('image/png');
    expect(result.success.headers['content-disposition']).toBe('inline');
  });

  it('sends a text body as text and a form body as a form', async () => {
    const text = await run(bodies().echoText({ payload: 'as is' }) as never);
    const form = await run(
      bodies().echoForm({ payload: { token: 't-1' } }) as never,
    );

    expect(text).toMatchObject({ _tag: 'Success', success: 'as is' });
    expect(form).toMatchObject({ _tag: 'Success', success: 't-1' });
  });
});
