import { Context, Effect, Layer, ManagedRuntime } from 'effect';
import { describe, expect, it } from 'vitest';

import { verifiedContext } from '../verified/index.js';
import {
  defineVariants,
  dryRun,
  Otherwise,
  provideResolved,
  resolve,
  Unresolvable,
  type VerifiedContext,
  VerifiedContextTag,
  When,
} from './index.js';

interface Sell {
  readonly sell: () => string;
}
class SellTag extends Context.Service<SellTag, Sell>()('SellTag') {}

const storefront = { name: 'storefront', impl: { sell: () => 'storefront' } };
const counter = {
  name: 'counter',
  requires: { entitlements: ['sales-management'] },
  impl: { sell: () => 'counter' },
};
const fallback = { name: 'fallback', impl: { sell: () => 'fallback' } };

const isVendor = (context: VerifiedContext) => context.partyRole === 'vendor';

const rules = [When(isVendor).use(counter), Otherwise.use(storefront)];

const context = (
  overrides: Partial<Parameters<typeof verifiedContext>[0]> = {},
) =>
  verifiedContext({
    entitlements: ['sales-management'],
    roles: [],
    flags: [],
    config: {},
    ...overrides,
  });

describe('VerifiedContext', () => {
  it('cannot be written as an object literal', () => {
    // @ts-expect-error — the brand is unnameable outside this package
    const forged: VerifiedContext = {
      entitlements: [],
      roles: [],
      flags: [],
      config: {},
    };
    expect(forged).toBeDefined();
  });
});

describe('resolve', () => {
  it('picks the first rule that matches', () => {
    expect(
      Effect.runSync(resolve('sell', rules)(context({ partyRole: 'vendor' })))
        .name,
    ).toBe('counter');
    expect(Effect.runSync(resolve('sell', rules)(context())).name).toBe(
      'storefront',
    );
  });

  it('skips a variant the caller is not entitled to, before its predicate', () => {
    expect(
      Effect.runSync(
        resolve(
          'sell',
          rules,
        )(context({ partyRole: 'vendor', entitlements: [] })),
      ).name,
    ).toBe('storefront');
  });

  it.each([
    ['roles', { requires: { roles: ['admin'] } }, { roles: ['admin'] }],
    [
      'party roles',
      { requires: { partyRoles: ['vendor'] } },
      { partyRole: 'vendor' },
    ],
    [
      'channels',
      { requires: { channels: ['counter'] } },
      { channel: 'counter' },
    ],
  ])('checks %s too', (_label, requirement, facts) => {
    const guarded = [Otherwise.use({ ...fallback, ...requirement })];

    expect(dryRun(guarded, context())).toBeUndefined();
    expect(dryRun(guarded, context(facts))).toEqual({
      variant: 'fallback',
      rule: 0,
    });
  });

  it('fails Unresolvable when nothing matches', () => {
    const failure = Effect.runSync(
      Effect.flip(resolve('sell', [When(isVendor).use(counter)])(context())),
    );

    expect(failure).toBeInstanceOf(Unresolvable);
    expect(failure.code).toBe('variantUnavailable');
    expect(failure.category).toBe('forbidden');
    expect(failure.message).toContain("'sell'");
  });

  it('annotates the span with the use case and the variant', () => {
    const attributes = Effect.runSync(
      Effect.gen(function* () {
        yield* resolve('sell', rules)(context({ partyRole: 'vendor' }));
        const span = yield* Effect.currentSpan;
        return span.attributes;
      }).pipe(Effect.withSpan('test')),
    );

    expect(attributes.get('entifix.use_case')).toBe('sell');
    expect(attributes.get('entifix.variant')).toBe('counter');
  });
});

describe('dryRun', () => {
  it('names the variant and the rule index without running anything', () => {
    expect(dryRun(rules, context({ partyRole: 'vendor' }))).toEqual({
      variant: 'counter',
      rule: 0,
    });
    expect(dryRun(rules, context())).toEqual({
      variant: 'storefront',
      rule: 1,
    });
  });
});

describe('provideResolved', () => {
  const variants = defineVariants(SellTag, rules);
  const program = provideResolved(variants)(
    Effect.map(SellTag, service => service.sell()),
  );

  it('defaults the use case to the tag key and lists each variant once', () => {
    expect(variants.useCase).toBe('SellTag');
    expect(defineVariants(SellTag, rules, 'sale').useCase).toBe('sale');
    expect(variants.variants.map(variant => variant.name)).toEqual([
      'counter',
      'storefront',
    ]);
  });

  // The point of binding per request: one layer graph, two implementations.
  it('gives two requests with different contexts different implementations', () => {
    let builds = 0;
    const runtime = ManagedRuntime.make(
      Layer.effectDiscard(
        Effect.sync(() => {
          builds += 1;
        }),
      ),
    );
    const run = (verified: VerifiedContext) =>
      runtime.runSync(
        program.pipe(Effect.provideService(VerifiedContextTag, verified)),
      );

    expect(run(context({ partyRole: 'vendor' }))).toBe('counter');
    expect(run(context())).toBe('storefront');
    expect(builds).toBe(1);
  });

  it('fails Unresolvable when the request resolves to nothing', () => {
    const only = provideResolved(
      defineVariants(SellTag, [When(isVendor).use(counter)]),
    )(Effect.map(SellTag, service => service.sell()));

    expect(
      Effect.runSync(
        Effect.flip(
          only.pipe(Effect.provideService(VerifiedContextTag, context())),
        ),
      ),
    ).toBeInstanceOf(Unresolvable);
  });
});
