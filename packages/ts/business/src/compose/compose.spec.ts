import { Effect, Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import {
  CompositionRefused,
  defineCatalog,
  defineFragment,
  encodeSlip,
  flowCommit,
  FlowRequirementsUnmet,
} from '../flow/index.js';
import { Otherwise, Unresolvable, When } from '../resolve/index.js';
import { verifiedContext } from '../verified/index.js';
import {
  compose,
  enumerateCompositions,
  expectAllCompositionsValid,
  type Recipe,
} from './index.js';

const contract = {
  input: Schema.Unknown,
  output: Schema.Unknown,
  failure: Schema.Unknown,
};

const reserve = defineFragment({
  id: 'stock.reserve',
  version: 1,
  module: 'stock',
  kind: 'compensatable',
  participant: 'stock',
  call: { method: 'POST', path: '/api/reservation' },
  compensation: { method: 'DELETE', path: '/api/reservation/:id' },
  cardinality: 'perLine',
  requires: { entitlements: ['stock-management'] },
  provides: { reservationId: Schema.String },
  contract,
});
const capture = defineFragment({
  id: 'payment.capture',
  version: 1,
  module: 'payment',
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
  module: 'stock',
  kind: 'retriable',
  participant: 'stock',
  call: { method: 'POST', path: '/api/reservation/:id/conversion' },
  cardinality: 'perLine',
  consumes: { reservationId: Schema.String },
  contract,
});

const catalog = defineCatalog([reserve, capture, convert, flowCommit]);

const Basket = Schema.Struct({
  vendors: Schema.Array(
    Schema.Struct({ id: Schema.String, paymentMethod: Schema.String }),
  ),
});
type Basket = typeof Basket.Type;

const paysByCard = (basket: Basket) =>
  basket.vendors.some(vendor => vendor.paymentMethod === 'card');

const checkout: Recipe<Basket> = {
  name: 'checkout',
  input: Basket,
  requiresCommitPoint: true,
  segments: basket =>
    basket.vendors.map(vendor => ({
      vendor: vendor.id,
      paymentMethod: vendor.paymentMethod,
    })),
  resolve: [
    {
      useCase: 'checkout',
      rules: [
        When(context => context.channel === 'counter').use({
          name: 'counter',
          impl: undefined,
        }),
        Otherwise.use({ name: 'storefront', impl: undefined }),
      ],
    },
  ],
  stages: [
    {
      name: 'hold',
      perSegment: true,
      steps: [
        {
          ref: 'stock.reserve@1',
          parameters: context => ({ ttl: context.config['holdTtl'] }),
        },
      ],
    },
    {
      name: 'pay',
      steps: [
        {
          ref: 'payment.capture@1',
          when: (_context, basket) => paysByCard(basket),
        },
        {
          ref: 'flow.commit@1',
          when: (_context, basket) => !paysByCard(basket),
        },
      ],
    },
    { name: 'convert', perSegment: true, steps: [{ ref: 'stock.convert@1' }] },
  ],
};

const context = (entitlements: readonly string[] = ['stock-management']) =>
  verifiedContext({
    entitlements,
    roles: [],
    flags: [],
    config: { holdTtl: 900 },
  });

const card: Basket = { vendors: [{ id: 'v-1', paymentMethod: 'card' }] };
const cod: Basket = {
  vendors: [
    { id: 'v-1', paymentMethod: 'cashOnDelivery' },
    { id: 'v-2', paymentMethod: 'cashOnDelivery' },
  ],
};
const options = { flowId: 'flow-1', composedAt: '2026-10-28T00:00:00.000Z' };

const run = <A, E>(effect: Effect.Effect<A, E>) => Effect.runSync(effect);

describe('compose', () => {
  it('composes a card checkout, pinning versions and parameters', () => {
    const slip = run(compose(checkout, catalog, context(), card, options));

    expect(
      slip.stages.map(stage => stage.steps.map(step => step.step)),
    ).toEqual([
      ['v-1/card:stock.reserve'],
      ['payment.capture'],
      ['v-1/card:stock.convert'],
    ]);
    expect(slip.stages[0]?.steps[0]).toMatchObject({
      ref: 'stock.reserve@1',
      participant: 'stock',
      compensation: { method: 'DELETE', path: '/api/reservation/:id' },
      segment: { vendor: 'v-1', paymentMethod: 'card' },
      parameters: { ttl: 900 },
    });
    expect(slip.resolution).toEqual([
      { useCase: 'checkout', variant: 'storefront', rule: 1 },
    ]);
    expect(slip.requiresCommitPoint).toBe(true);
  });

  it('expands a two-vendor cash-on-delivery basket around flow.commit@1', () => {
    const slip = run(compose(checkout, catalog, context(), cod, options));

    expect(slip.stages.map(stage => stage.steps.length)).toEqual([2, 1, 2]);
    expect(slip.stages[1]?.steps[0]?.ref).toBe('flow.commit@1');
  });

  // Determinism is what lets a slip be a pinned record rather than a guess.
  it('yields byte-identical slips for the same context and input', () => {
    const once = JSON.stringify(
      encodeSlip(run(compose(checkout, catalog, context(), card, options))),
    );
    const twice = JSON.stringify(
      encodeSlip(run(compose(checkout, catalog, context(), card, options))),
    );

    expect(once).toBe(twice);
  });

  it('refuses an unknown id@n with UnknownFragment, never throws', () => {
    const broken: Recipe<Basket> = {
      ...checkout,
      stages: [
        ...checkout.stages,
        { name: 'extra', steps: [{ ref: 'stock.reserve@9' }] },
      ],
    };

    const failure = run(
      Effect.flip(compose(broken, catalog, context(), card, options)),
    );

    expect(failure).toBeInstanceOf(CompositionRefused);
    expect(
      (failure as CompositionRefused).violations.map(
        violation => violation.tag,
      ),
    ).toContain('UnknownFragment');
  });

  it('forbids a caller who lacks only what a step requires', () => {
    const failure = run(
      Effect.flip(compose(checkout, catalog, context([]), card, options)),
    );

    expect(failure).toBeInstanceOf(FlowRequirementsUnmet);
    expect(failure).toMatchObject({
      code: 'flowRequirementsUnmet',
      category: 'forbidden',
    });
    expect((failure as FlowRequirementsUnmet).message).toContain(
      "entitlement 'stock-management'",
    );
  });

  it('fails Unresolvable when a use case resolves to nothing', () => {
    const unresolvable: Recipe<Basket> = {
      ...checkout,
      resolve: [
        {
          useCase: 'nobody',
          rules: [When(() => false).use({ name: 'x', impl: 1 })],
        },
      ],
    };

    expect(
      run(
        Effect.flip(compose(unresolvable, catalog, context(), card, options)),
      ),
    ).toBeInstanceOf(Unresolvable);
  });

  it('refuses start input its schema does not accept, as invalid', () => {
    const failure = run(
      Effect.flip(
        compose(checkout, catalog, context(), { vendors: 'no' }, options),
      ),
    );

    expect(failure._tag).toBe('Invalid');
  });

  it('annotates the span with the slip version and its fragments', () => {
    const attributes = run(
      Effect.gen(function* () {
        yield* compose(checkout, catalog, context(), card, options);
        return (yield* Effect.currentSpan).attributes;
      }).pipe(Effect.withSpan('compose')),
    );

    expect(attributes.get('entifix.slip.version')).toBe(1);
    expect(attributes.get('entifix.slip.fragments')).toBe(
      'stock.reserve@1,payment.capture@1,stock.convert@1',
    );
  });

  it('composes a recipe with no segments, resolutions or commit requirement', () => {
    const plain: Recipe<unknown> = {
      name: 'plain',
      input: Schema.Unknown,
      provides: { reservationId: Schema.String },
      stages: [
        {
          name: 'skipped',
          when: () => false,
          steps: [{ ref: 'stock.reserve@1' }],
        },
        {
          name: 'empty',
          perSegment: true,
          steps: [{ ref: 'stock.convert@1' }],
        },
        { name: 'one', steps: [{ ref: 'payment.capture@1', step: 'capture' }] },
      ],
    };

    const slip = run(compose(plain, catalog, context(), {}, options));

    expect(slip.stages).toEqual([
      {
        name: 'one',
        steps: [
          {
            ref: 'payment.capture@1',
            step: 'capture',
            cardinality: 'one',
            participant: 'payment',
            call: { method: 'POST', path: '/api/payment' },
          },
        ],
      },
    ]);
    expect(slip).not.toHaveProperty('requiresCommitPoint');
  });
});

describe('compose, threading the start input', () => {
  const Order = Schema.Struct({
    buyer: Schema.String,
    digest: Schema.String,
    vendors: Schema.Array(
      Schema.Struct({
        id: Schema.String,
        paymentMethod: Schema.String,
        entitlements: Schema.Array(Schema.String),
        lines: Schema.Array(
          Schema.Struct({ offeringId: Schema.String, quantity: Schema.Number }),
        ),
      }),
    ),
  });
  type Order = typeof Order.Type;

  const threaded: Recipe<Order> = {
    name: 'threaded',
    input: Order,
    requiresCommitPoint: true,
    segments: order =>
      order.vendors.map(vendor => ({
        vendor: vendor.id,
        paymentMethod: vendor.paymentMethod,
        entitlements: vendor.entitlements,
      })),
    lines: (order, segment) =>
      order.vendors
        .filter(vendor => segment === undefined || vendor.id === segment.vendor)
        .flatMap(vendor =>
          vendor.lines.map(line => ({
            key: line.offeringId,
            parameters: {
              offeringId: line.offeringId,
              quantity: line.quantity,
            },
          })),
        ),
    audience: (order, _context, flowId) => [
      { kind: 'flow', id: flowId, digest: order.digest },
      { kind: 'party', id: order.buyer },
    ],
    stages: [
      {
        name: 'hold',
        perSegment: true,
        steps: [
          {
            ref: 'stock.reserve@1',
            parameters: (context, order, segment, line) => ({
              organizationId: segment?.vendor,
              ttl: context.config['holdTtl'],
              buyer: order.buyer,
              line: line?.key,
            }),
          },
        ],
      },
      { name: 'pay', steps: [{ ref: 'flow.commit@1' }] },
      { name: 'convert', steps: [{ ref: 'stock.convert@1' }] },
    ],
  };

  const order: Order = {
    buyer: 'p-1',
    digest: 'd-1',
    vendors: [
      {
        id: 'v-1',
        paymentMethod: 'cod',
        entitlements: ['stock-management'],
        lines: [
          { offeringId: 'o-1', quantity: 2 },
          { offeringId: 'o-2', quantity: 1 },
        ],
      },
    ],
  };

  it('expands a perLine step once per line, with the input, segment and line in its parameters', () => {
    const slip = run(compose(threaded, catalog, context([]), order, options));

    expect(slip.stages[0]?.steps).toEqual([
      expect.objectContaining({
        step: 'v-1/cod:o-1:stock.reserve',
        line: 'o-1',
        parameters: {
          offeringId: 'o-1',
          quantity: 2,
          organizationId: 'v-1',
          ttl: 900,
          buyer: 'p-1',
          line: 'o-1',
        },
      }),
      expect.objectContaining({
        step: 'v-1/cod:o-2:stock.reserve',
        line: 'o-2',
      }),
    ]);
    // Outside a segment, a perLine step expands over every line.
    expect(slip.stages[2]?.steps.map(step => step.step)).toEqual([
      'o-1:stock.convert',
      'o-2:stock.convert',
    ]);
  });

  it('pins the recipe audience on the slip', () => {
    const slip = run(compose(threaded, catalog, context([]), order, options));

    expect(slip.audience).toEqual([
      { kind: 'flow', id: 'flow-1', digest: 'd-1' },
      { kind: 'party', id: 'p-1' },
    ]);
  });

  it('checks a segment step against the entitlements verified for its segment', () => {
    const unprovisioned: Order = {
      ...order,
      vendors: order.vendors.map(vendor => ({ ...vendor, entitlements: [] })),
    };

    expect(
      Effect.runSync(
        Effect.flip(
          compose(threaded, catalog, context([]), unprovisioned, options),
        ),
      ),
    ).toBeInstanceOf(FlowRequirementsUnmet);
  });
});

describe('enumerateCompositions', () => {
  const axes = {
    contexts: [
      { label: 'entitled', value: context() },
      {
        label: 'counter',
        value: verifiedContext({
          entitlements: ['stock-management'],
          roles: [],
          flags: [],
          config: {},
          channel: 'counter',
        }),
      },
    ],
    inputs: [
      { label: 'card × 1', value: card },
      { label: 'cod × 2', value: cod },
    ],
  };

  it('composes every combination of a sound recipe', () => {
    const outcomes = enumerateCompositions(checkout, catalog, axes);

    expect(outcomes).toHaveLength(4);
    expect(outcomes.every(outcome => outcome.outcome === 'composed')).toBe(
      true,
    );
    expect(() => expectAllCompositionsValid(outcomes)).not.toThrow();
  });

  it('reports exactly a planted invalid combination', () => {
    // Capturing in every basket puts a capture inside a cash-on-delivery one.
    const planted: Recipe<Basket> = {
      ...checkout,
      stages: checkout.stages.map(stage =>
        stage.name === 'pay'
          ? {
              name: 'pay',
              perSegment: true,
              steps: [{ ref: 'payment.capture@1' }],
            }
          : stage,
      ),
    };

    const outcomes = enumerateCompositions(planted, catalog, {
      ...axes,
      contexts: [axes.contexts[0] ?? { label: 'none', value: context() }],
    });

    expect(outcomes.filter(outcome => outcome.outcome === 'refused')).toEqual([
      expect.objectContaining({ input: 'cod × 2' }),
    ]);
    expect(() => expectAllCompositionsValid(outcomes)).toThrow(
      /entitled × cod × 2: .*ExcludedFromSegment/,
    );
  });

  it('tells a caller who lacks an entitlement apart from a defect', () => {
    const outcomes = enumerateCompositions(checkout, catalog, {
      ...axes,
      contexts: [
        ...axes.contexts,
        {
          label: 'storefront buyer',
          value: verifiedContext({
            entitlements: [],
            roles: [],
            flags: [],
            config: {},
          }),
        },
      ],
    });

    expect(outcomes.filter(outcome => outcome.outcome !== 'composed')).toEqual([
      expect.objectContaining({
        context: 'storefront buyer',
        input: 'card × 1',
        outcome: 'unmet',
      }),
      expect.objectContaining({
        context: 'storefront buyer',
        input: 'cod × 2',
        outcome: 'unmet',
      }),
    ]);
    expect(() => expectAllCompositionsValid(outcomes)).not.toThrow();
  });

  it('counts a caller offered nothing as unresolvable, not as a defect', () => {
    const outcomes = enumerateCompositions(
      {
        ...checkout,
        resolve: [
          {
            useCase: 'nobody',
            rules: [When(() => false).use({ name: 'x', impl: 1 })],
          },
        ],
      },
      catalog,
      axes,
    );

    expect(outcomes.every(outcome => outcome.outcome === 'unresolvable')).toBe(
      true,
    );
    expect(() => expectAllCompositionsValid(outcomes)).not.toThrow();
  });

  it('enumerates a recipe that resolves nothing and provides start keys', () => {
    const rest = Object.fromEntries(
      Object.entries(checkout).filter(([member]) => member !== 'resolve'),
    ) as Omit<typeof checkout, 'resolve'>;
    const started: Recipe<Basket> = {
      ...rest,
      provides: { reservationId: Schema.String },
    };

    expect(
      enumerateCompositions(started, catalog, axes).every(
        outcome => outcome.outcome === 'composed',
      ),
    ).toBe(true);
  });
});

describe('a guard on a wait’s answer', () => {
  const report = defineFragment({
    id: 'parcel.report',
    version: 1,
    module: 'parcel',
    kind: 'wait',
    participant: 'parcel',
    call: { method: 'GET', path: '/api/parcel/:id' },
    cardinality: 'one',
    outcomes: ['delivered', 'refused'],
    contract,
  });
  const close = defineFragment({
    id: 'parcel.close',
    version: 1,
    module: 'parcel',
    kind: 'retriable',
    participant: 'parcel',
    call: { method: 'POST', path: '/api/parcel/:id/closed' },
    cardinality: 'one',
    contract,
  });
  const restore = defineFragment({
    id: 'parcel.restore',
    version: 1,
    module: 'parcel',
    kind: 'retriable',
    participant: 'parcel',
    call: { method: 'POST', path: '/api/parcel/restoration' },
    cardinality: 'perLine',
    contract,
  });
  const parcels = defineCatalog([capture, report, close, restore]);

  const Parcel = Schema.Struct({ lines: Schema.Array(Schema.String) });
  type Parcel = typeof Parcel.Type;

  const delivery = (segmented: boolean): Recipe<Parcel> => ({
    name: 'delivery',
    input: Parcel,
    ...(segmented
      ? { segments: () => [{ vendor: 'v-1', paymentMethod: 'card' }] }
      : {}),
    lines: parcel => parcel.lines.map(key => ({ key, parameters: { key } })),
    stages: [
      {
        name: 'ship',
        perSegment: segmented,
        steps: [
          { ref: 'payment.capture@1' },
          {
            ref: 'parcel.report@1',
            parameters: () => ({ onTimeout: { outcome: 'unanswered' } }),
          },
        ],
      },
      {
        name: 'returned',
        perSegment: segmented,
        on: { wait: 'parcel.report', outcomes: ['refused', 'unanswered'] },
        steps: [
          { ref: 'parcel.restore@1' },
          {
            ref: 'parcel.close@1',
            on: { wait: 'parcel.report', outcomes: ['delivered'] },
          },
        ],
      },
    ],
  });

  const guardsOf = (segmented: boolean) =>
    Effect.runPromise(
      compose(
        delivery(segmented),
        parcels,
        context(),
        { lines: ['a', 'b'] },
        options,
      ),
    ).then(slip =>
      slip.stages
        .flatMap(stage => stage.steps)
        .map(step => [step.step, step.guard]),
    );

  it('pins a stage’s guard on every step, and a step’s own over it', async () => {
    expect(await guardsOf(false)).toEqual([
      ['payment.capture', undefined],
      ['parcel.report', undefined],
      [
        'a:parcel.restore',
        { wait: 'parcel.report', outcomes: ['refused', 'unanswered'] },
      ],
      [
        'b:parcel.restore',
        { wait: 'parcel.report', outcomes: ['refused', 'unanswered'] },
      ],
      ['parcel.close', { wait: 'parcel.report', outcomes: ['delivered'] }],
    ]);
  });

  it('names the wait in the guarded step’s own segment', async () => {
    const guards = await guardsOf(true);

    expect(guards.at(-1)).toEqual([
      'v-1/card:parcel.close',
      { wait: 'v-1/card:parcel.report', outcomes: ['delivered'] },
    ]);
  });
});
