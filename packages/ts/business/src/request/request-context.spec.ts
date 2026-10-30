import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import {
  IdempotencyKeyTag,
  OrganizationIdTag,
  type RequestPrincipal,
  RequestPrincipalTag,
} from './request-context.js';

const principal: RequestPrincipal = {
  userId: 'u1',
  subject: 'ada',
  sessionId: 's1',
  roles: ['admin'],
  attributes: {},
};

describe('the request-context tags', () => {
  it('hand a handler what the shell verified, with no transport in sight', async () => {
    const read = Effect.gen(function* () {
      return {
        principal: yield* RequestPrincipalTag,
        organizationId: yield* OrganizationIdTag,
        key: yield* IdempotencyKeyTag,
      };
    });

    expect(
      await Effect.runPromise(
        read.pipe(
          Effect.provideService(RequestPrincipalTag, principal),
          Effect.provideService(OrganizationIdTag, 'org-1'),
          Effect.provideService(IdempotencyKeyTag, 'k-1'),
        ),
      ),
    ).toEqual({ principal, organizationId: 'org-1', key: 'k-1' });
  });

  it('are absent unless a guard provided them', async () => {
    const absent = await Effect.runPromise(
      Effect.serviceOption(RequestPrincipalTag),
    );

    expect(absent._tag).toBe('None');
  });
});
