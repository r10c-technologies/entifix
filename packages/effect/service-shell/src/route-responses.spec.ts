import {
  DuplicateKey,
  EntifixBuildError,
  EntifixConnError,
  InvalidEnvelope,
  InvalidQuery,
  PROBLEM_CONTENT_TYPE,
  Unavailable,
} from '@entifix/core';
import { Cause, Effect } from 'effect';
import { HttpServerResponse } from 'effect/http';
import { describe, expect, it } from 'vitest';

import {
  EntityRouteRefusal,
  invalid,
  legacyAnswer,
} from './route-responses.js';

const answer = async (
  response: Effect.Effect<HttpServerResponse.HttpServerResponse, unknown>,
) => {
  const web = HttpServerResponse.toWeb(await Effect.runPromise(response));
  return { status: web.status, body: await web.json() };
};

// The bridge an unmigrated route crosses while the adapters raise typed
// failures and the route still answers through `invalid`.
describe('invalid, given a typed failure', () => {
  it('answers a business failure with its category status and its own code', async () => {
    expect(
      await answer(
        invalid(new DuplicateKey({ key: 'slug' }), 'nope', 'fallback'),
      ),
    ).toEqual({
      status: 409,
      body: { error: 'nope', code: 'duplicateKey' },
    });
  });

  it("names a body that is not an envelope by the route's own code", async () => {
    expect(
      await answer(
        invalid(
          new InvalidEnvelope({ reason: 'no meta.type' }),
          'bad body',
          'invalidBody',
        ),
      ),
    ).toEqual({
      status: 400,
      body: { error: 'bad body', code: 'invalidBody', detail: 'no meta.type' },
    });
  });

  it('carries a failure message as the detail', async () => {
    const { body } = await answer(
      invalid(new InvalidQuery({ reason: 'unknown member' }), 'bad', 'x'),
    );

    expect(body).toMatchObject({
      code: 'invalidQuery',
      detail: 'unknown member',
    });
  });

  it('leaves a technical failure to the 500 it always answered', async () => {
    const { status, body } = await answer(
      invalid(new Unavailable(), 'bad', 'x'),
    );

    expect(status).toBe(500);
    expect(body).toMatchObject({ code: 'unexpected' });
  });
});

describe('legacyAnswer', () => {
  const run = (error: unknown) =>
    Effect.runPromise(Effect.exit(legacyAnswer('invalidBody')(error)));

  const answered = async (error: unknown) => {
    const exit = await run(error);
    if (exit._tag !== 'Success') throw new Error('expected an answer');
    const web = HttpServerResponse.toWeb(exit.value);
    return {
      status: web.status,
      type: web.headers.get('content-type'),
      body: await web.json(),
    };
  };

  it('answers a refusal as its own problem body', async () => {
    expect(
      await answered(new EntityRouteRefusal(409, 'nameTaken', 'already used')),
    ).toEqual({
      status: 409,
      type: PROBLEM_CONTENT_TYPE,
      body: {
        type: 'urn:entifix:failure:nameTaken',
        title: 'nameTaken',
        status: 409,
        code: 'nameTaken',
        category: 'conflict',
        detail: 'already used',
      },
    });
    expect(
      (await answered(new EntityRouteRefusal(422, 'reserved'))).body,
    ).not.toHaveProperty('detail');
  });

  it('answers a domain error with its own code, or the fallback', async () => {
    const coded = Object.assign(new EntifixBuildError('not https'), {
      code: 'mediaNotHttps',
    });

    expect((await answered(coded)).body).toMatchObject({
      status: 400,
      code: 'mediaNotHttps',
      category: 'invalid',
    });
    expect((await answered(new EntifixBuildError('bad'))).body).toMatchObject({
      code: 'invalidBody',
    });
  });

  it('passes a typed failure through for respond to answer', async () => {
    const exit = await run(new DuplicateKey({}));

    expect(exit._tag === 'Failure' && Cause.squash(exit.cause)).toMatchObject({
      _tag: 'DuplicateKey',
    });
  });

  it('reads an unreachable store as Unavailable', async () => {
    const exit = await run(new EntifixConnError('down'));

    expect(exit._tag === 'Failure' && Cause.squash(exit.cause)).toMatchObject({
      _tag: 'Unavailable',
    });
  });

  it('treats anything else as a defect', async () => {
    const exit = await run(new Error('boom'));

    expect(exit._tag === 'Failure' && Cause.hasDies(exit.cause)).toBe(true);
  });
});

describe('invalid, given the old class tree', () => {
  it('answers a domain error with its own code, or the route code', async () => {
    const coded = Object.assign(new EntifixBuildError('not https'), {
      code: 'mediaNotHttps',
    });

    expect(await answer(invalid(coded, 'bad', 'invalidBody'))).toEqual({
      status: 400,
      body: { error: 'bad', code: 'mediaNotHttps', detail: 'not https' },
    });
    expect(
      (await answer(invalid(new EntifixBuildError('x'), 'bad', 'invalidBody')))
        .body,
    ).toMatchObject({ code: 'invalidBody' });
  });

  it('answers a refusal with its own status and code', async () => {
    expect(
      await answer(
        invalid(new EntityRouteRefusal(409, 'nameTaken', 'used'), 'bad', 'x'),
      ),
    ).toEqual({
      status: 409,
      body: {
        error: 'the record cannot be saved',
        code: 'nameTaken',
        detail: 'used',
      },
    });
    expect(
      (
        await answer(
          invalid(new EntityRouteRefusal(422, 'reserved'), 'bad', 'x'),
        )
      ).body,
    ).not.toHaveProperty('detail');
  });
});
