import { describe, expect, it } from 'vitest';

import { tokenFailureFrom } from './token-failures.js';

describe('tokenFailureFrom', () => {
  it('reads expiry as its own answer', () => {
    expect(tokenFailureFrom({ code: 'ERR_JWT_EXPIRED' })).toMatchObject({
      _tag: 'ExpiredToken',
      code: 'expiredToken',
      category: 'unauthenticated',
    });
  });

  it.each([
    [{ code: 'ERR_JWKS_TIMEOUT' }],
    [{ code: 'ERR_JWKS_NO_MATCHING_KEY' }],
    [new TypeError('fetch failed')],
  ])('reads %j as the key set being unreachable', error => {
    expect(tokenFailureFrom(error, 'zitadel')).toMatchObject({
      _tag: 'Unavailable',
      dependency: 'zitadel',
    });
  });

  it('reads anything else as a token that does not verify', () => {
    expect(
      tokenFailureFrom({ code: 'ERR_JWS_SIGNATURE_VERIFICATION_FAILED' }),
    ).toMatchObject({ _tag: 'InvalidToken', code: 'invalidToken' });
    expect(tokenFailureFrom(null)).toMatchObject({ _tag: 'InvalidToken' });
    expect(tokenFailureFrom({ code: 'ERR_JWKS_TIMEOUT' })).toMatchObject({
      dependency: 'jwks',
    });
  });
});
