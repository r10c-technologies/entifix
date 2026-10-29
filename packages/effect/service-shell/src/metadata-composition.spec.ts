import { Otherwise, When } from '@entifix/business';
import type { Recipe } from '@entifix/business/compose';
import {
  defineCatalog,
  defineFragment,
  flowCommit,
} from '@entifix/business/flow';
import type { UseCaseDescriptor } from '@entifix/core';
import { Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { verifiedContextOf } from './auth/verified-context.js';
import { compositionFor } from './metadata-composition.js';
import { narrowingFor } from './narrowing.js';

const descriptor = (
  overrides: Partial<UseCaseDescriptor>,
): UseCaseDescriptor => ({
  key: 'sell',
  binding: 'entity',
  placement: 'determining',
  labelKey: 'x',
  ...overrides,
});

const guarded = defineFragment({
  id: 'stock.reserve',
  version: 1,
  module: 'stock',
  kind: 'compensatable',
  participant: 'stock',
  call: { method: 'POST', path: '/api/reservation' },
  compensation: { method: 'DELETE', path: '/api/reservation/:id' },
  cardinality: 'perLine',
  requires: { entitlements: ['stock-management'] },
  contract: {
    input: Schema.Unknown,
    output: Schema.Unknown,
    failure: Schema.Unknown,
  },
});

const recipe: Recipe<unknown> = {
  name: 'checkout',
  input: Schema.Unknown,
  resolve: [
    {
      useCase: 'checkout',
      rules: [Otherwise.use({ name: 'storefront', impl: 1 })],
    },
  ],
  stages: [
    { name: 'gated', when: () => false, steps: [{ ref: 'stock.reserve@1' }] },
    {
      name: 'main',
      steps: [
        { ref: 'flow.commit@1' },
        { ref: 'stock.reserve@1', when: () => false },
        { ref: 'flow.commit@1' },
      ],
    },
  ],
};

const anonymous = verifiedContextOf(undefined);

describe('compositionFor', () => {
  it('answers nothing for a verb that names neither variants nor a recipe', () => {
    expect(compositionFor(descriptor({}), anonymous, {})).toBeUndefined();
  });

  it('takes the variant from the recipe when the verb names no variant set', () => {
    expect(
      compositionFor(descriptor({ recipe: 'checkout' }), anonymous, {
        recipes: { checkout: recipe },
        catalog: defineCatalog([guarded, flowCommit]),
      }),
    ).toEqual({
      useCase: 'sell',
      variant: 'storefront',
      recipe: 'checkout',
      slipVersion: 1,
      fragments: ['stock.reserve@1', 'flow.commit@1'],
    });
  });

  // A gate the document cannot evaluate never hides a verb.
  it('ignores the requirements of gated stages and steps', () => {
    expect(
      compositionFor(descriptor({ recipe: 'checkout' }), anonymous, {
        recipes: { checkout: recipe },
        catalog: defineCatalog([guarded, flowCommit]),
      }),
    ).not.toBe('unreachable');
  });

  it('is unreachable when a recipe resolution matches nothing', () => {
    expect(
      compositionFor(descriptor({ recipe: 'checkout' }), anonymous, {
        recipes: {
          checkout: {
            ...recipe,
            resolve: [
              {
                useCase: 'x',
                rules: [When(() => false).use({ name: 'n', impl: 1 })],
              },
            ],
          },
        },
      }),
    ).toBe('unreachable');
  });

  it('reads an absent recipe or catalog as nothing to check', () => {
    expect(
      compositionFor(descriptor({ variants: 'v', recipe: 'gone' }), anonymous, {
        variants: { v: [Otherwise.use({ name: 'only', impl: 1 })] },
      }),
    ).toEqual({
      useCase: 'sell',
      variant: 'only',
      recipe: 'gone',
      slipVersion: 1,
      fragments: [],
    });
    expect(
      compositionFor(descriptor({ variants: 'missing' }), anonymous, {}),
    ).toBe('unreachable');
  });

  it('defaults the variant of a recipe that resolves nothing', () => {
    const { resolve: _resolve, ...bare } = recipe;
    expect(
      compositionFor(descriptor({ recipe: 'checkout' }), anonymous, {
        recipes: { checkout: bare },
      }),
    ).toMatchObject({ variant: 'default' });
  });
});

describe('verifiedContextOf', () => {
  it('builds an anonymous context with nothing held', () => {
    expect(anonymous).toEqual({
      entitlements: [],
      roles: [],
      flags: [],
      config: {},
    });
  });

  it('carries what the verified principal says, and the dials', () => {
    expect(
      verifiedContextOf(
        {
          userId: 'u',
          subject: 's',
          sessionId: 'x',
          roles: ['admin'],
          organizationId: 'org-1',
          partyId: 'p-1',
          partyRole: 'vendor',
          entitlements: ['stock-management'],
          attributes: {},
        },
        { limit: 3 },
      ),
    ).toEqual({
      organizationId: 'org-1',
      partyId: 'p-1',
      partyRole: 'vendor',
      entitlements: ['stock-management'],
      roles: ['admin'],
      flags: [],
      config: { limit: 3 },
    });
  });
});

describe('narrowingFor', () => {
  // A caller no rule matches sees nothing: the direction a gap must fail in.
  it('narrows to nothing when no rule matches', () => {
    expect(narrowingFor([], anonymous)).toBe('nothing');
  });
});
