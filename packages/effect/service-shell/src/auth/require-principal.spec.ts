import { type TokenClaims, TokenServiceTag } from '@entifix/business';
import { ACCESS_COOKIE, Unauthenticated } from '@entifix/core';
import { Effect, Option } from 'effect';
import { HttpServerRequest } from 'effect/http';
import { describe, expect, it } from 'vitest';

import { resolveRequestPrincipal } from './require-principal.js';

const claims: TokenClaims = {
  userId: 'u-1',
  subject: 'sub-1',
  sessionId: 's-1',
  roles: ['admin'],
  activeOrganizationId: 'org-1',
};

const tokens = (answer: TokenClaims | undefined) => ({
  verify: (token: string) =>
    answer !== undefined && token === 'good'
      ? Effect.succeed(answer)
      : Effect.fail(new Unauthenticated()),
});

const resolve = (
  headers: Record<string, string>,
  answer: TokenClaims | undefined = claims,
) =>
  Effect.runPromise(
    resolveRequestPrincipal.pipe(
      Effect.provideService(
        HttpServerRequest.HttpServerRequest,
        HttpServerRequest.fromWeb(new Request('http://svc/x', { headers })),
      ),
      Effect.provideService(TokenServiceTag, tokens(answer) as never),
    ),
  );

describe('resolveRequestPrincipal', () => {
  it('rebuilds the principal from a bearer token, carrying its expiry', async () => {
    const principal = await resolve(
      { authorization: 'Bearer good' },
      { ...claims, exp: 1_900_000_000 },
    );
    expect(Option.getOrThrow(principal)).toMatchObject({
      userId: 'u-1',
      organizationId: 'org-1',
      expiresAt: 1_900_000_000,
      entitlements: [],
    });
  });

  it('reads the forwarded cookie, and leaves an absent expiry unset', async () => {
    const principal = await resolve({ cookie: `${ACCESS_COOKIE}=good` });
    expect(Option.getOrThrow(principal).expiresAt).toBeUndefined();
  });

  it.each([
    ['no token', {}],
    ['a non-bearer scheme', { authorization: 'Basic good' }],
    ['a token that does not verify', { authorization: 'Bearer bad' }],
  ])('answers nobody for %s', async (_label, headers) => {
    expect(Option.isNone(await resolve(headers))).toBe(true);
  });
});
