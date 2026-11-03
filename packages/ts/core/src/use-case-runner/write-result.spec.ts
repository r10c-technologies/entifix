import { describe, expect, it } from 'vitest';

import { flowLink, isPending, pending, settled } from './write-result.js';

describe('write results', () => {
  it('tells a settled write from a pending one', () => {
    expect(isPending(settled(1))).toBe(false);
    expect(isPending(pending('f-1'))).toBe(true);
    expect(settled('x')).toEqual({ _tag: 'settled', value: 'x' });
    expect(pending('f-1')).toEqual({
      _tag: 'pending',
      flowId: 'f-1',
      links: [],
    });
  });

  it('finds the link a pending write named', () => {
    const result = pending('f-1', [{ rel: 'status', href: '/api/flow/f-1' }]);
    expect(flowLink(result, 'status')).toBe('/api/flow/f-1');
    expect(flowLink(result, 'stream')).toBeUndefined();
  });
});
