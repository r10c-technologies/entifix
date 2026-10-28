import { Contention } from '@entifix/core';
import { describe, expect, it } from 'vitest';

import { translateRedisError } from './translate-redis-error.js';

describe('translateRedisError', () => {
  it('reads a command that timed out as a timeout', () => {
    expect(translateRedisError(new Error('Command timed out'))).toMatchObject({
      _tag: 'Timeout',
      dependency: 'redis',
    });
    expect(
      translateRedisError(new Error('Connection timeout'), 'sessions'),
    ).toMatchObject({ _tag: 'Timeout', dependency: 'sessions' });
  });

  it('reads anything else as unavailable', () => {
    expect(
      translateRedisError(new Error('Connection is closed.')),
    ).toMatchObject({
      _tag: 'Unavailable',
    });
    expect(translateRedisError(undefined)).toMatchObject({
      _tag: 'Unavailable',
    });
  });

  it('passes a failure already translated through', () => {
    const lost = new Contention();

    expect(translateRedisError(lost)).toBe(lost);
  });
});
