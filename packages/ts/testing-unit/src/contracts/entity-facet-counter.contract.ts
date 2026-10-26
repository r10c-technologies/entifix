import type { EntityFacetCounter } from '@entifix/business';
import { describe, expect, it } from 'vitest';

import { run } from '../effect/run.js';
import {
  ContractWidget,
  makeContractWidget,
} from './entity-repository.contract.js';

export interface EntityFacetCounterContractOptions {
  /**
   * Builds a counter over `seed`. Called fresh for each test, so no state
   * leaks between them.
   */
  makeCounter(
    seed: ContractWidget[],
  ): EntityFacetCounter | Promise<EntityFacetCounter>;
  /**
   * `false` for a counter reached through the query protocol. A collection
   * member is never `filterable` — core refuses to declare one so — and the
   * protocol counts only filterable members, so over the wire an array member
   * is a `400` before any counter sees it. Defaults to `true`.
   */
  readonly countsCollections?: boolean;
}

const seeded = () => [
  makeContractWidget('w-1', 'Alpha', 10, ['blue', 'green']),
  makeContractWidget('w-2', 'Beta', 10, ['green']),
  makeContractWidget('w-3', 'Alpha', 30, ['green', 'red']),
];

/**
 * What every {@link EntityFacetCounter} must answer alike: how many records
 * hold each value of each member, each member under its own filtering — the
 * semantics of a Mongo `$facet` of `$match`, `$unwind` and `$group`.
 *
 * Run it against the in-memory counter *and* against each real adapter, so the
 * fake a consumer's specs use cannot drift into a more forgiving version of
 * the engine.
 *
 * Which member a request may count is the protocol's rule, not the counter's
 * (`parseFacetQueryParams`): a counter counts what it is handed.
 */
export const describeEntityFacetCounterContract = (
  name: string,
  { makeCounter, countsCollections = true }: EntityFacetCounterContractOptions,
): void => {
  describe(`EntityFacetCounter contract: ${name}`, () => {
    const withCounter = async (
      use: (counter: EntityFacetCounter) => Promise<void>,
      seed: ContractWidget[] = seeded(),
    ) => {
      await use(await makeCounter(seed));
    };

    it('counts every value of every member, highest count first', async () => {
      await withCounter(async counter => {
        const counts = await run(
          counter.count<ContractWidget>([
            { member: 'name' },
            { member: 'size' },
          ]),
        );

        expect(counts).toEqual({
          name: [
            { value: 'Alpha', count: 2 },
            { value: 'Beta', count: 1 },
          ],
          size: [
            { value: 10, count: 2 },
            { value: 30, count: 1 },
          ],
        });
      });
    });

    it('counts each member under its own filtering only', async () => {
      await withCounter(async counter => {
        const counts = await run(
          counter.count<ContractWidget>([
            {
              member: 'name',
              filtering: [{ property: 'size', operator: 'eq', value: 10 }],
            },
            {
              member: 'size',
              filtering: [{ property: 'name', operator: 'eq', value: 'Alpha' }],
            },
          ]),
        );

        expect(counts).toEqual({
          name: [
            { value: 'Alpha', count: 1 },
            { value: 'Beta', count: 1 },
          ],
          size: [
            { value: 10, count: 1 },
            { value: 30, count: 1 },
          ],
        });
      });
    });

    it.runIf(countsCollections)(
      'counts each element of an array member',
      async () => {
        await withCounter(async counter => {
          const counts = await run(
            counter.count<ContractWidget>([{ member: 'tags' }]),
          );

          expect(counts).toEqual({
            tags: [
              { value: 'green', count: 3 },
              { value: 'blue', count: 1 },
              { value: 'red', count: 1 },
            ],
          });
        });
      },
    );

    it('does not count a missing value', async () => {
      const unnamed = new ContractWidget();
      unnamed.id = 'w-9';
      await withCounter(
        async counter => {
          const counts = await run(
            counter.count<ContractWidget>([{ member: 'name' }]),
          );

          expect(counts).toEqual({ name: [{ value: 'Alpha', count: 1 }] });
        },
        [makeContractWidget('w-1', 'Alpha', 10), unnamed],
      );
    });

    it.runIf(countsCollections)('does not count an empty array', async () => {
      await withCounter(
        async counter => {
          const counts = await run(
            counter.count<ContractWidget>([{ member: 'tags' }]),
          );

          expect(counts).toEqual({ tags: [] });
        },
        [makeContractWidget('w-1', 'Alpha', 10)],
      );
    });

    it('answers every queried member, empty, from an empty store', async () => {
      await withCounter(async counter => {
        expect(
          await run(
            counter.count<ContractWidget>([
              { member: 'name' },
              { member: 'size' },
            ]),
          ),
        ).toEqual({ name: [], size: [] });
      }, []);
    });
  });
};
