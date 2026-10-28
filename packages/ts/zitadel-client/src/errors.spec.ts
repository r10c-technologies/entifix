import { Unavailable } from '@entifix/core';
import { describe, expect, it } from 'vitest';

import { ProviderAnswered, providerFailure } from './errors.js';

describe('providerFailure', () => {
  it('reads a 4xx answer as the provider declining, with its reason', () => {
    expect(
      providerFailure(new ProviderAnswered(409, 'User already exists')),
    ).toMatchObject({ _tag: 'Declined', reason: 'User already exists' });
  });

  it('reads a 5xx answer or a network error as the provider not answering', () => {
    expect(
      providerFailure(new ProviderAnswered(502, 'bad gateway')),
    ).toMatchObject({
      _tag: 'Unavailable',
      dependency: 'zitadel',
    });
    expect(providerFailure(new TypeError('fetch failed'))).toMatchObject({
      _tag: 'Unavailable',
    });
    expect(providerFailure(undefined)).toMatchObject({ _tag: 'Unavailable' });
  });

  it('reads a body that is not JSON as a protocol failure', () => {
    expect(
      providerFailure(new SyntaxError('Unexpected token <')),
    ).toMatchObject({
      _tag: 'ProtocolFailure',
    });
  });

  it('passes a failure raised inside the request through', () => {
    const down = new Unavailable({ dependency: 'jwks' });

    expect(providerFailure(down)).toBe(down);
  });
});
