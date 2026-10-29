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
    const { resolve: _resolve, ...rest } = checkout;
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
