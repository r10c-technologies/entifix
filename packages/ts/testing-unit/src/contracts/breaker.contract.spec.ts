import {
  makeInMemoryBulkhead,
  makeInMemoryCircuitBreaker,
} from '@entifix/transactions/engine';
import { Effect } from 'effect';

import {
  BREAKER_CONTRACT_DIALS,
  describeBreakerContract,
} from './breaker.contract.js';

describeBreakerContract('the in-memory engines', clock =>
  Effect.sync(() => ({
    breaker: makeInMemoryCircuitBreaker({
      dials: BREAKER_CONTRACT_DIALS,
      now: clock.now,
    }),
    bulkhead: makeInMemoryBulkhead({ permits: 2 }),
  })),
);
