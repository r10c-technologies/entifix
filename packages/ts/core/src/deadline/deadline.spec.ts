import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import {
  currentRemainingMs,
  DEADLINE_HEADER,
  deadlineFromHeader,
  DeadlineTag,
  remainingMs,
} from './deadline.js';

describe('the request deadline', () => {
  it('travels as a remainder in milliseconds', () => {
    expect(DEADLINE_HEADER).toBe('x-request-timeout-ms');
    expect(deadlineFromHeader('250', 1_000)).toEqual({ expiresAt: 1_250 });
    expect(deadlineFromHeader(' 0 ', 1_000)).toEqual({ expiresAt: 1_000 });
  });

  it.each([undefined, '', 'soon', '-5', '1.5'])(
    'reads %j as no deadline at all',
    value => {
      expect(deadlineFromHeader(value, 1_000)).toBeUndefined();
    },
  );

  it('never reports a negative remainder', () => {
    expect(remainingMs({ expiresAt: 1_000 }, 1_200)).toBe(0);
    expect(remainingMs({ expiresAt: 1_500 }, 1_200)).toBe(300);
  });

  it('reads the current request’s remainder, or nothing without one', async () => {
    expect(await Effect.runPromise(currentRemainingMs)).toBeUndefined();

    const left = await Effect.runPromise(
      currentRemainingMs.pipe(
        Effect.provideService(DeadlineTag, { expiresAt: Date.now() + 60_000 }),
      ),
    );

    expect(left).toBeGreaterThan(50_000);
  });
});
