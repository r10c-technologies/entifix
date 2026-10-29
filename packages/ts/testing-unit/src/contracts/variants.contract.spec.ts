import { defineVariants, Otherwise, When } from '@entifix/business';
import { Context } from 'effect';
import { describe, expect, it } from 'vitest';

import {
  forEachVariant,
  variantsWithoutContract,
} from './variants.contract.js';

interface Greeter {
  readonly greet: () => string;
}
class GreeterTag extends Context.Service<GreeterTag, Greeter>()('GreeterTag') {}

const loud = { name: 'loud', impl: { greet: () => 'HELLO' } };
const quiet = { name: 'quiet', impl: { greet: () => 'hello' } };
const broken = { name: 'broken', impl: { greet: () => '' } };

const greeting = defineVariants(GreeterTag, [
  When(context => context.flags.includes('loud')).use(loud),
  Otherwise.use(quiet),
]);

const ranUnder: string[] = [];
forEachVariant(
  defineVariants(GreeterTag, [Otherwise.use(broken)], 'named'),
  (_impl, variant) => {
    ranUnder.push(variant.name);
    it('runs', () => {
      expect(variant.name).toBe('broken');
    });
  },
);

forEachVariant(greeting, impl => {
  it('says something', () => {
    expect(impl.greet().length).toBeGreaterThan(0);
  });
});

describe('forEachVariant', () => {
  // A suite that runs a breaking variant fails under that variant's name.
  it('runs the suite once per variant, naming it', () => {
    expect(ranUnder).toEqual(['broken']);
  });
});

describe('variantsWithoutContract', () => {
  it('lists a planted variant no suite ran against, and only that one', () => {
    const planted = defineVariants(
      GreeterTag,
      [When(() => false).use(broken), Otherwise.use(quiet)],
      'planted',
    );

    expect(variantsWithoutContract([greeting, planted])).toEqual([
      'planted:broken',
      'planted:quiet',
    ]);
  });
});
