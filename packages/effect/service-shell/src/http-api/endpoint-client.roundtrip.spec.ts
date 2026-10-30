import { makeStaticPolicyDecision, PolicyDecisionTag } from '@entifix/authz';
import { InvalidToken, TokenServiceTag } from '@entifix/business';
import { defineEndpoint, Failure, implement, Unavailable } from '@entifix/core';
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

const groups = [
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
