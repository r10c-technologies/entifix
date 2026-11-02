import { Effect, Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import {
  assertValidSlip,
  catalogDocument,
  CompositionRefused,
  decodeSlip,
  defineCatalog,
  defineFragment,
  encodeSlip,
  flowCommit,
  FlowRequirementsUnmet,
  type FragmentDescriptor,
  fragmentFingerprint,
  fragmentRef,
  type Slip,
  type SlipStep,
  validateSlip,
} from './index.js';

const ReservationId = Schema.String;
const contract = {
  input: Schema.Struct({ sku: Schema.String }),
  output: Schema.Struct({ reservationId: Schema.String }),
  failure: Schema.Struct({ code: Schema.String }),
};

const reserve = defineFragment({
  id: 'stock.reserve',
  version: 1,
  module: 'stock-management',
  kind: 'compensatable',
  participant: 'stock',
  call: { method: 'POST', path: '/api/reservation' },
  compensation: { method: 'DELETE', path: '/api/reservation/:id' },
  cardinality: 'perLine',
  isolation: 'commutative',
  requires: { entitlements: ['stock-management'] },
  provides: { reservationId: ReservationId, sku: Schema.String },
  contract,
});

const capture = defineFragment({
  id: 'payment.capture',
  version: 1,
  module: 'payment-management',
  kind: 'pivot',
  participant: 'payment',
  call: { method: 'POST', path: '/api/payment' },
  cardinality: 'one',
  irreversible: true,
  excludedFrom: { paymentMethod: ['cashOnDelivery'] },
  contract,
});

const convert = defineFragment({
  id: 'stock.convert',
  version: 1,
  module: 'stock-management',
  kind: 'retriable',
  participant: 'stock',
  call: { method: 'POST', path: '/api/reservation/:id/conversion' },
  cardinality: 'perLine',
  consumes: { reservationId: ReservationId },
  contract,
});

const awaitDelivery = defineFragment({
  id: 'fulfilment.await-delivery',
  version: 1,
  module: 'fulfilment',
  kind: 'wait',
  participant: 'fulfilment',
  call: { method: 'GET', path: '/api/shipping-order/:id' },
  cardinality: 'perVendor',
  contract,
});

const shipNow = defineFragment({
  id: 'fulfilment.ship',
  version: 1,
  module: 'fulfilment',
  kind: 'retriable',
  participant: 'fulfilment',
  call: { method: 'POST', path: '/api/shipping-order' },
  cardinality: 'perVendor',
  irreversible: true,
  contract,
});

const lookup = defineFragment({
  id: 'catalog.price-lines',
  version: 1,
  module: 'catalog',
  kind: 'compensatable',
  readOnly: true,
  participant: 'marketplace',
  call: { method: 'GET', path: '/api/published-offering' },
  cardinality: 'perLine',
  contract,
});

const catalog = defineCatalog([
  reserve,
  capture,
  convert,
  awaitDelivery,
  shipNow,
  lookup,
  flowCommit,
]);

const step = (
  fragment: FragmentDescriptor,
  overrides: Partial<SlipStep> = {},
): SlipStep => ({
  ref: fragmentRef(fragment),
  step: fragment.id,
  cardinality: fragment.cardinality,
  ...(fragment.participant === undefined
    ? {}
    : { participant: fragment.participant }),
  ...(fragment.call === undefined ? {} : { call: fragment.call }),
  ...overrides,
});

const slipOf = (
  steps: readonly SlipStep[],
  overrides: Partial<Slip> = {},
): Slip => ({
  slipVersion: 1,
  flowId: 'flow-1',
  recipe: 'checkout',
  requiresCommitPoint: true,
  stages: [{ name: 'main', steps }],
  resolution: [],
  composedAt: '2026-10-28T00:00:00.000Z',
  ...overrides,
});

const tags = (slip: Slip, options?: Parameters<typeof validateSlip>[2]) =>
  validateSlip(slip, catalog, options).map(violation => violation.tag);

const cardSlip = slipOf([
  step(reserve),
  step(capture, { segment: { paymentMethod: 'card' } }),
  step(convert),
]);

const codSlip = slipOf([
  step(reserve, {
    segment: { vendor: 'v-1', paymentMethod: 'cashOnDelivery' },
  }),
  step(flowCommit),
  step(convert),
  step(awaitDelivery),
]);

describe('defineFragment', () => {
  it('returns a well-formed descriptor unchanged', () => {
    expect(defineFragment(reserve)).toBe(reserve);
  });

  it.each([
    ['a malformed id', { id: 'Reserve' }, "'domain.verb'"],
    ['a non-integer version', { version: 1.5 }, 'positive integer'],
    ['a zero version', { version: 0 }, 'positive integer'],
    [
      'a participant without a call',
      { call: undefined },
      'together, or neither',
    ],
    [
      'a compensatable step with no compensation',
      { compensation: undefined },
      'declares its compensation',
    ],
    [
      'an irreversible compensatable step',
      { irreversible: true },
      'cannot be irreversible',
    ],
  ])('throws on %s', (_label, overrides, message) => {
    expect(() =>
      defineFragment({ ...reserve, ...overrides } as FragmentDescriptor),
    ).toThrow(message);
  });

  it('throws on a non-pivot marker', () => {
    expect(() =>
      defineFragment({
        ...flowCommit,
        kind: 'retriable',
      } as FragmentDescriptor),
    ).toThrow('only a pivot may be a marker');
  });

  it('throws on a compensation declared by a step that cannot have one', () => {
    expect(() =>
      defineFragment({
        ...convert,
        compensation: { method: 'DELETE', path: '/x' },
      } as FragmentDescriptor),
    ).toThrow('a retriable step cannot declare a compensation');
  });
});

describe('validateSlip', () => {
  it('finds nothing wrong with a valid card slip', () => {
    expect(validateSlip(cardSlip, catalog)).toEqual([]);
  });

  it('finds nothing wrong with a valid cash-on-delivery slip', () => {
    expect(validateSlip(codSlip, catalog)).toEqual([]);
  });

  it('refuses a fragment the catalog does not hold', () => {
    expect(tags(slipOf([step(reserve, { ref: 'stock.reserve@9' })]))).toContain(
      'UnknownFragment',
    );
  });

  it('refuses two pivots', () => {
    expect(
      tags(slipOf([step(reserve), step(capture), step(flowCommit)])),
    ).toContain('TooManyPivots');
  });

  it('refuses a checkout with no commit point', () => {
    expect(tags(slipOf([step(reserve)]))).toEqual(['MissingCommitPoint']);
  });

  it('refuses a retriable step with no commit point anywhere', () => {
    expect(
      tags(
        slipOf([step(reserve), step(convert)], { requiresCommitPoint: false }),
      ),
    ).toEqual(['MissingCommitPoint']);
  });

  it('lets a slip with neither a retriable step nor a checkout go without one', () => {
    expect(
      tags(slipOf([step(reserve)], { requiresCommitPoint: undefined })),
    ).toEqual([]);
  });

  it('refuses stock.convert before the commit point', () => {
    expect(tags(slipOf([step(reserve), step(convert), step(capture)]))).toEqual(
      ['RetriableBeforeCommit'],
    );
  });

  it('refuses a compensatable step after the commit point', () => {
    expect(tags(slipOf([step(capture), step(reserve)]))).toEqual([
      'CompensatableAfterCommit',
    ]);
  });

  it('refuses an irreversible step before the commit point', () => {
    expect(
      tags(
        slipOf([step(shipNow), step(capture)], { requiresCommitPoint: false }),
      ),
    ).toEqual(['RetriableBeforeCommit', 'IrreversibleBeforeCommit']);
  });

  it('refuses a wait before the commit point', () => {
    expect(tags(slipOf([step(awaitDelivery), step(capture)]))).toEqual([
      'WaitBeforeCommit',
    ]);
  });

  it('refuses a wait in a slip with no commit point at all', () => {
    expect(
      tags(slipOf([step(awaitDelivery)], { requiresCommitPoint: false })),
    ).toEqual(['WaitBeforeCommit']);
  });

  it('refuses a capture inside a cash-on-delivery segment', () => {
    expect(
      tags(
        slipOf([
          step(reserve),
          step(capture, { segment: { paymentMethod: 'cashOnDelivery' } }),
        ]),
      ),
    ).toEqual(['ExcludedFromSegment']);
  });

  it('refuses an input nothing earlier provides', () => {
    expect(tags(slipOf([step(capture), step(convert)]))).toEqual([
      'UnsatisfiedInput',
    ]);
  });

  it('accepts an input the start provides', () => {
    expect(
      tags(slipOf([step(capture), step(convert)]), {
        start: { reservationId: Schema.String },
      }),
    ).toEqual([]);
  });

  it('refuses an input provided with another schema', () => {
    expect(
      tags(slipOf([step(capture), step(convert)]), {
        start: { reservationId: Schema.Number },
      }),
    ).toEqual(['UnsatisfiedInput']);
  });

  it('refuses a requirement the verified context does not meet', () => {
    expect(tags(cardSlip, { context: { entitlements: [] } })).toEqual([
      'UnmetRequirement',
    ]);
    expect(tags(cardSlip, { context: {} })).toEqual(['UnmetRequirement']);
    expect(
      tags(cardSlip, { context: { entitlements: ['stock-management'] } }),
    ).toEqual([]);
  });

  it('checks roles, party roles and channels too', () => {
    const picky = defineFragment({
      ...lookup,
      id: 'catalog.picky',
      requires: {
        roles: ['admin'],
        partyRoles: ['vendor'],
        channels: ['counter'],
      },
    });
    const pickyCatalog = defineCatalog([picky, capture]);
    const slip = slipOf([step(picky), step(capture)]);

    expect(
      validateSlip(slip, pickyCatalog, { context: {} })[0]?.detail,
    ).toContain("role 'admin', party role in vendor, channel in counter");
    expect(
      validateSlip(slip, pickyCatalog, {
        context: { roles: ['admin'], partyRole: 'vendor', channel: 'counter' },
      }),
    ).toEqual([]);
    expect(
      validateSlip(slip, pickyCatalog, {
        context: { roles: ['viewer'], partyRole: 'vendor', channel: 'counter' },
      })[0]?.detail,
    ).toContain("role 'admin'");
  });

  it('reports every violation at once, not the first', () => {
    expect(
      tags(
        slipOf([
          step(awaitDelivery),
          step(convert),
          step(capture),
          step(reserve),
        ]),
      ),
    ).toEqual([
      'WaitBeforeCommit',
      'RetriableBeforeCommit',
      'UnsatisfiedInput',
      'CompensatableAfterCommit',
    ]);
  });
});

describe('assertValidSlip', () => {
  it('passes a valid slip through', () => {
    expect(Effect.runSync(assertValidSlip(cardSlip, catalog))).toBe(cardSlip);
  });

  it('refuses an invalid one with every violation, as flowNotComposable', () => {
    const failure = Effect.runSync(
      Effect.flip(assertValidSlip(slipOf([step(reserve)]), catalog)),
    );

    expect(failure).toBeInstanceOf(CompositionRefused);
    expect(failure.code).toBe('flowNotComposable');
    expect(failure.category).toBe('declined');
    expect(failure.message).toContain('MissingCommitPoint');
  });

  it('forbids a caller who lacks only a requirement, as flowRequirementsUnmet', () => {
    const failure = Effect.runSync(
      Effect.flip(assertValidSlip(cardSlip, catalog, { context: {} })),
    );

    expect(failure).toBeInstanceOf(FlowRequirementsUnmet);
    expect(failure.category).toBe('forbidden');
  });

  it('refuses a slip that also breaks a rule no caller could repair', () => {
    const failure = Effect.runSync(
      Effect.flip(
        assertValidSlip(slipOf([step(reserve)]), catalog, { context: {} }),
      ),
    );

    expect(failure).toBeInstanceOf(CompositionRefused);
    expect(
      (failure as CompositionRefused).violations.map(
        violation => violation.tag,
      ),
    ).toEqual(
      expect.arrayContaining(['MissingCommitPoint', 'UnmetRequirement']),
    );
  });
});

describe('the slip schema', () => {
  it.each([
    ['card', cardSlip],
    ['cash on delivery', codSlip],
  ])('round-trips a %s slip as the workflow payload', (_label, slip) => {
    const wire = JSON.parse(JSON.stringify(encodeSlip(slip))) as unknown;

    expect(Effect.runSync(decodeSlip(wire))).toEqual(slip);
  });

  it('refuses an unknown slipVersion as a protocol failure', () => {
    const failure = Effect.runSync(
      Effect.flip(decodeSlip({ ...cardSlip, slipVersion: 2 })),
    );

    expect(failure.category).toBe('protocol');
    expect(failure.reason).toContain('the slip does not decode');
  });
});

describe('the catalog', () => {
  it('lists its references in order and finds one by reference', () => {
    expect(catalog.refs).toEqual([...catalog.refs].sort());
    expect(catalog.get('stock.reserve@1')).toBe(reserve);
  });

  it('accepts the same descriptor twice', () => {
    expect(() => defineCatalog([reserve, reserve])).not.toThrow();
  });

  it('refuses two descriptors claiming one reference', () => {
    expect(() =>
      defineCatalog([reserve, { ...reserve, module: 'elsewhere' }]),
    ).toThrow("fragment 'stock.reserve@1' is declared twice");
  });

  it('documents itself as stable JSON', () => {
    const document = catalogDocument(catalog);

    expect(JSON.parse(JSON.stringify(document))).toEqual(document);
    expect(document.fragments.map(fragment => fragment.ref)).toEqual(
      catalog.refs,
    );
    expect(
      document.fragments.find(f => f.ref === 'flow.commit@1'),
    ).toMatchObject({
      kind: 'pivot',
      readOnly: false,
      isolation: 'none',
    });
    expect(document).toMatchSnapshot();
  });
});

describe('fragmentFingerprint', () => {
  it('changes when the contract input changes', () => {
    const changed = {
      ...reserve,
      contract: { ...contract, input: Schema.Struct({ sku: Schema.Number }) },
    };

    expect(fragmentFingerprint(changed)).not.toBe(fragmentFingerprint(reserve));
  });

  it('does not change when only the module or isolation does', () => {
    expect(
      fragmentFingerprint({ ...reserve, module: 'renamed', isolation: 'none' }),
    ).toBe(fragmentFingerprint(reserve));
  });
});
