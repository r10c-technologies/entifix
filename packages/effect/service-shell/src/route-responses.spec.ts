import {
  DuplicateKey,
  InvalidEnvelope,
  InvalidQuery,
  Unavailable,
} from '@entifix/core';
import { Effect } from 'effect';
import { HttpServerResponse } from 'effect/http';
import { describe, expect, it } from 'vitest';

import { invalid } from './route-responses.js';

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
