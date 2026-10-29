import {
  decodeEnvelope,
  decodeEvent,
  encodeEnvelope,
  encodeEvent,
} from '@entifix/core';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import {
  digestFlowCapability,
  makeFlowCapability,
  verifyFlowCapability,
} from './flow-capability.js';
import { flowEvent } from './flow-messages.js';

const run = <A, E>(effect: Effect.Effect<A, E>) => Effect.runPromise(effect);

const started = flowEvent({
  name: 'flow.started',
  source: 'transaction',
  at: '2026-10-28T00:00:00.000Z',
  step: 'started',
  ordinal: 0,
  audience: [{ kind: 'party', id: 'buyer-1' }],
  data: { flowId: 'flow-1', definition: 'checkout', slipVersion: 1 },
});

describe('flow events', () => {
  it('carry the step as their id, the flow as correlation and the ordinal as version', () => {
    expect(started).toMatchObject({
      id: 'flow-1:started',
      correlationId: 'flow-1',
      version: 0,
    });
  });

  it('round-trip through the codec', async () => {
    const wire = JSON.parse(
      JSON.stringify(await run(encodeEvent(started))),
    ) as unknown;

    expect(await run(decodeEvent(wire))).toEqual(started);
  });

  it('refuse a flow.failed whose failure has no code or category', async () => {
    const failed = flowEvent({
      ...{
        name: 'flow.failed',
        source: 'transaction',
        at: '2026-10-28T00:00:00.000Z',
        step: 'payment.capture',
        ordinal: 2,
        audience: [{ kind: 'party', id: 'buyer-1' }],
      },
      data: {
        flowId: 'flow-1',
        definition: 'checkout',
        slipVersion: 1,
        failure: { code: 'declined', category: 'declined' },
      },
    });
    const { data, ...meta } = failed;

    expect(
      await run(decodeEvent({ meta: { type: 'event', event: meta }, data })),
    ).toEqual(failed);
    for (const failure of [
      undefined,
      { code: 'declined' },
      { category: 'declined' },
    ]) {
      const body = {
        meta: { type: 'event', event: meta },
        data: { ...data, failure },
      };
      expect((await run(Effect.flip(decodeEvent(body)))).category).toBe(
        'protocol',
      );
    }
  });

  it('refuse to encode without an audience', async () => {
    expect(
      (await run(Effect.flip(encodeEvent({ ...started, audience: [] }))))
        .reason,
    ).toContain('must name its audience');
  });
});

describe('flowAccepted', () => {
  it('round-trips, and refuses a link it does not know', async () => {
    const accepted = {
      meta: { type: 'flowAccepted' },
      data: {
        flowId: 'flow-1',
        links: [
          { rel: 'status', href: '/api/flow/flow-1' },
          { rel: 'stream', href: '/api/stream?topic=flow:flow-1' },
        ],
      },
    };

    expect(
      await run(decodeEnvelope(await run(encodeEnvelope(accepted)))),
    ).toEqual(accepted);
    expect(
      (
        await run(
          Effect.flip(
            decodeEnvelope({
              ...accepted,
              data: { flowId: 'f', links: [{ rel: 'other', href: '/' }] },
            }),
          ),
        )
      ).category,
    ).toBe('protocol');
  });
});

describe('the flow capability', () => {
  it('verifies the nonce it was minted with', async () => {
    const capability = await run(makeFlowCapability());

    expect(capability.nonce).toMatch(/^[0-9a-f]{64}$/);
    expect(capability.digest).toBe(
      await run(digestFlowCapability(capability.nonce)),
    );
    expect(
      await run(verifyFlowCapability(capability.nonce, capability.digest)),
    ).toBe(true);
  });

  it('rejects a wrong nonce, an empty one, and a digest of another length', async () => {
    const capability = await run(makeFlowCapability());
    const other = await run(makeFlowCapability());

    expect(
      await run(verifyFlowCapability(other.nonce, capability.digest)),
    ).toBe(false);
    expect(await run(verifyFlowCapability('', capability.digest))).toBe(false);
    expect(await run(verifyFlowCapability(capability.nonce, 'short'))).toBe(
      false,
    );
  });

  it('mints a different capability every time', async () => {
    const a = await run(makeFlowCapability());
    const b = await run(makeFlowCapability());

    expect(a.nonce).not.toBe(b.nonce);
  });
});
