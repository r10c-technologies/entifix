import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { ServiceCrossingCallersTag } from './require-service-crossing.js';

describe('ServiceCrossingCallersTag', () => {
  it('names no caller unless the composition provides one', () => {
    const callers = Effect.runSync(Effect.service(ServiceCrossingCallersTag));

    expect(callers.size).toBe(0);
  });
});
