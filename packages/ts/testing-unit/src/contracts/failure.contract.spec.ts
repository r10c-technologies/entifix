import {
  Contention,
  Declined,
  DuplicateKey,
  Forbidden,
  IdempotencyKeyInFlight,
  IdempotencyKeyMissing,
  IdempotencyKeyReused,
  Internal,
  Invalid,
  InvalidEnvelope,
  InvalidQuery,
  InvalidRecords,
  NotFound,
  Overloaded,
  ProtocolFailure,
  Timeout,
  Unauthenticated,
  Unavailable,
  UpstreamUnavailable,
} from '@entifix/core';

import { describeFailureContract } from './failure.contract.js';

const samples = [
  new Invalid({ errors: [{ pointer: '/name', detail: 'empty', code: 'x' }] }),
  new InvalidQuery({ reason: 'unknown member' }),
  new InvalidEnvelope({ reason: 'no meta.type' }),
  new InvalidRecords({ errors: [] }),
  new Unauthenticated(),
  new Forbidden(),
  new NotFound({ entity: 'brand' }),
  new DuplicateKey({ key: 'slug' }),
  new Declined({ reason: 'card' }),
  new Contention(),
  new Overloaded({ retryAfterSeconds: 2 }),
  new Unavailable({ dependency: 'mongo' }),
  new UpstreamUnavailable({ upstream: 'catalog' }),
  new Timeout(),
  new ProtocolFailure({ reason: 'not a problem', upstreamStatus: 500 }),
  new Internal(),
  new IdempotencyKeyMissing(),
  new IdempotencyKeyReused(),
  new IdempotencyKeyInFlight(),
];

for (const sample of samples) describeFailureContract(sample._tag, sample);
