import { Effect, Exit, Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import {
  audienceAdmits,
  decodeEnvelope,
  decodeEvent,
  encodeEnvelope,
  encodeEvent,
  EntityChangeEnvelope,
  Envelope,
} from './codec.js';
import { decodeRequestEnvelope } from './read-envelope.js';
import {
  lookupEvent,
  lookupMessage,
  registeredEvents,
  registeredMessages,
  registerEvent,
  registerMessage,
} from './registry.js';
import type { DomainEvent } from './types.js';

const Published = Schema.Struct({ sku: Schema.String, price: Schema.Number });

registerEvent('test.published', Published, { versioned: true });
registerEvent('test.announced', Published, { audience: 'none' });

const anEvent = (
  overrides: Partial<DomainEvent<{ sku: string; price: number }>> = {},
): DomainEvent<{ sku: string; price: number }> => ({
  name: 'test.published',
  id: 'evt-1',
  source: 'catalog',
  at: '2026-01-01T00:00:00.000Z',
  correlationId: 'tx-1',
  aggregate: { type: 'offering', id: 'o-1' },
  version: 3,
  audience: [{ kind: 'organization', id: 'org-1' }],
  data: { sku: 'W-1', price: 10 },
  ...overrides,
});

const failureOf = <A, E>(effect: Effect.Effect<A, E>): E =>
  Effect.runSync(Effect.flip(effect));

describe('the message registry', () => {
  it('looks a registration up by type and by event name', () => {
    expect(lookupMessage('entity')?.kind).toBe('type');
    expect(lookupEvent('test.published')).toMatchObject({
      kind: 'event',
      versioned: true,
      audience: 'required',
    });
    expect(lookupEvent('test.announced')?.audience).toBe('none');
    expect(lookupMessage('nothing')).toBeUndefined();
  });

  it('lists every registration, ordered by name', () => {
    const names = registeredEvents().map(entry => entry.name);
    expect(names).toEqual([...names].sort());
    expect(registeredMessages().map(entry => entry.name)).toContain(
      'entityPage',
    );
  });

  // A module evaluated twice — a hot reload — builds an equal schema object.
  it('accepts the same name registered again with an equal schema', () => {
    expect(() =>
      registerEvent(
        'test.published',
        Schema.Struct({ sku: Schema.String, price: Schema.Number }),
        { versioned: true },
      ),
    ).not.toThrow();
  });

  it('throws on a name registered twice with a different schema', () => {
    expect(() =>
      registerEvent('test.published', Schema.Struct({ sku: Schema.String }), {
        versioned: true,
      }),
    ).toThrow("message 'test.published' is already registered");
    expect(() =>
      registerMessage('entity', Schema.Struct({ id: Schema.String })),
    ).toThrow("message 'entity'");
  });

  it('throws on a name registered twice with different requirements', () => {
    expect(() => registerEvent('test.published', Published)).toThrow(
      'already registered',
    );
  });
});

describe('decodeEvent', () => {
  it('round-trips an event through encode and decode', () => {
    const encoded = Effect.runSync(encodeEvent(anEvent()));
    const wire = JSON.parse(JSON.stringify(encoded)) as unknown;

    expect(Effect.runSync(decodeEvent(wire))).toEqual(anEvent());
  });

  it('keeps an event with no correlation id readable', () => {
    const encoded = Effect.runSync(
      encodeEvent(anEvent({ correlationId: undefined })),
    );

    expect(Effect.runSync(decodeEvent(encoded)).correlationId).toBeUndefined();
  });

  // The point of the record: `data` that drifted from its schema fails here,
  // at the edge of the consumer, instead of deep inside a handler.
  it('refuses data its schema rejects, as a protocol failure', () => {
    const failure = failureOf(
      decodeEvent({
        meta: { type: 'event', event: anEvent() },
        data: { sku: 'W-1', price: 'ten' },
      }),
    );

    expect(failure.category).toBe('protocol');
    expect(failure.reason).toContain("the data of 'test.published'");
  });

  it('refuses an event nothing registered', () => {
    const failure = failureOf(
      decodeEvent({
        meta: { type: 'event', event: anEvent({ name: 'test.unknown' }) },
        data: {},
      }),
    );

    expect(failure.reason).toContain(
      "no schema is registered for event 'test.unknown'",
    );
  });

  it('refuses a versioned event that carries no version', () => {
    const { version: _dropped, ...meta } = anEvent();
    const failure = failureOf(
      decodeEvent({
        meta: { type: 'event', event: meta },
        data: { sku: 'W-1', price: 1 },
      }),
    );

    expect(failure.reason).toContain('describes an aggregate version');
  });

  it('refuses an envelope of the wrong type', () => {
    expect(
      failureOf(decodeEvent({ meta: { type: 'entity' }, data: {} })).reason,
    ).toContain("expected an envelope of type 'event' but got 'entity'");
  });

  it('refuses an event envelope carrying no meta.event', () => {
    expect(
      failureOf(decodeEvent({ meta: { type: 'event' }, data: {} })).reason,
    ).toContain('carried no meta.event');
  });

  it('refuses a body that is not an envelope at all', () => {
    expect(failureOf(decodeEvent('nope')).reason).toContain(
      'is not an envelope',
    );
    expect(failureOf(decodeEvent(new Error('x'))).reason).toContain(
      'is not an envelope',
    );
  });

  // No `name` is unroutable, no `id` is undeduplicatable.
  it.each(['name', 'id', 'source', 'at'])('refuses an empty %s', member => {
    const failure = failureOf(
      decodeEvent({
        meta: { type: 'event', event: { ...anEvent(), [member]: '' } },
        data: { sku: 'W-1', price: 1 },
      }),
    );

    expect(failure.reason).toContain(member);
  });
});

describe('decodeEnvelope', () => {
  it('decodes a registered type and keeps members its schema does not name', () => {
    const decoded = Effect.runSync(
      decodeEnvelope({
        meta: { type: 'entityMetadata', entity: 'product', extra: 1 },
        data: { actions: [], useCases: [], composition: { a: 1 } },
      }),
    );

    expect(decoded.meta).toMatchObject({ extra: 1 });
    expect(decoded.data).toMatchObject({ composition: { a: 1 } });
  });

  it('refuses a type nothing registered', () => {
    expect(
      failureOf(decodeEnvelope({ meta: { type: 'nothing' }, data: 1 })).reason,
    ).toContain("no schema is registered for message type 'nothing'");
  });
});

describe('decodeRequestEnvelope', () => {
  // A request that does not decode is the sender's fault: `400`, not `502`.
  it('fails with InvalidEnvelope, naming the label', () => {
    const failure = failureOf(
      decodeRequestEnvelope({ meta: { type: 'entity' } }, 'entityPage', 'brand'),
    );

    expect(failure._tag).toBe('InvalidEnvelope');
    expect(failure.reason).toContain('"brand"');
  });

  it('defaults the label', () => {
    expect(
      failureOf(decodeRequestEnvelope({}, 'entity')).reason,
    ).toContain('"message"');
  });
});

describe('encodeEnvelope', () => {
  it('refuses an event that needs an audience and names none', () => {
    expect(
      failureOf(encodeEvent(anEvent({ audience: [] }))).reason,
    ).toContain('must name its audience');
    expect(
      failureOf(encodeEvent(anEvent({ audience: undefined }))).reason,
    ).toContain('must name its audience');
  });

  it('lets an event registered audience-free go without one', () => {
    const encoded = Effect.runSync(
      encodeEvent(
        anEvent({ name: 'test.announced', audience: undefined, version: 1 }),
      ),
    );

    expect(encoded.meta.event.name).toBe('test.announced');
  });

  it('refuses a versioned event with no version', () => {
    expect(
      failureOf(encodeEvent(anEvent({ version: undefined }))).reason,
    ).toContain('describes an aggregate version');
  });

  it('refuses data its schema cannot encode', () => {
    const bad = anEvent() as unknown as DomainEvent<unknown>;
    expect(
      failureOf(encodeEvent({ ...bad, data: { sku: 1 } })).reason,
    ).toContain('does not encode');
  });

  it('refuses a type nothing registered', () => {
    expect(
      failureOf(encodeEnvelope({ meta: { type: 'nothing' }, data: 1 })).reason,
    ).toContain('no schema is registered');
  });
});

describe('Envelope.codec', () => {
  it('frames one data schema without the registry', () => {
    const decode = Schema.decodeUnknownExit(Envelope.codec(Published));

    expect(
      Exit.isSuccess(
        decode({ meta: { type: 'anything' }, data: { sku: 'a', price: 1 } }),
      ),
    ).toBe(true);
    expect(Exit.isFailure(decode({ meta: { type: 'x' }, data: {} }))).toBe(
      true,
    );
  });

  it('decodes an entity change, and refuses a change it does not know', () => {
    const decode = Schema.decodeUnknownExit(EntityChangeEnvelope);
    const meta = { type: 'event', event: anEvent() };

    expect(
      Exit.isSuccess(
        decode({ meta, data: { entity: 'brand', change: 'created', id: 'b' } }),
      ),
    ).toBe(true);
    expect(
      Exit.isFailure(
        decode({ meta, data: { entity: 'brand', change: 'moved', id: 'b' } }),
      ),
    ).toBe(true);
  });
});

describe('audienceAdmits', () => {
  const audience = [
    { kind: 'organization' as const, id: 'org-1' },
    { kind: 'party' as const, id: 'party-1' },
    { kind: 'flow' as const, id: 'flow-1', digest: 'abc' },
  ];

  it('admits a member of a named organization, party or flow', () => {
    expect(audienceAdmits(audience, { organizationId: 'org-1' })).toBe(true);
    expect(audienceAdmits(audience, { partyId: 'party-1' })).toBe(true);
    expect(audienceAdmits(audience, { flowDigests: ['abc'] })).toBe(true);
  });

  it('admits nobody else', () => {
    expect(audienceAdmits(audience, { organizationId: 'org-2' })).toBe(false);
    expect(audienceAdmits(audience, { flowDigests: ['zzz'] })).toBe(false);
    expect(audienceAdmits(audience, {})).toBe(false);
    expect(
      audienceAdmits([{ kind: 'flow', id: 'flow-1' }], { flowDigests: [] }),
    ).toBe(false);
  });

  // Fail closed: a message nobody addressed reaches nobody.
  it('admits nobody when the audience is empty or absent', () => {
    expect(audienceAdmits([], { organizationId: 'org-1' })).toBe(false);
    expect(audienceAdmits(undefined, { organizationId: 'org-1' })).toBe(false);
  });
});
