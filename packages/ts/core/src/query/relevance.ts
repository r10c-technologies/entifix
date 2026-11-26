import { describeEntityColumns } from '../entity-definition/describe/describe-entity-columns.js';
import { findMetaEntity } from '../entity-definition/helpers/entity-definition-helpers.js';
import type { Entity, EntityConstructor } from '../types/Entity.js';
import type { EntityFiltering } from '../types/EntityFiltering.js';
import { foldText } from './fold.js';

/**
 * The sort key that orders a search by how well each record matches it
 * ([ADR 0033](../../../../../docs/adr/0033-a-search-ranks-by-relevance.md)).
 *
 * It names no member, so the `sortable` allowlist does not apply to it: it
 * reads nothing a client could not already filter on. It is always
 * descending — the best match first — and the entries after it break ties.
 */
export const RELEVANCE = '$relevance' as const;

export type Relevance = typeof RELEVANCE;

/** A label that starts with the word. */
export const RELEVANCE_PREFIX = 3;
/** A word in the label that starts with it. */
export const RELEVANCE_WORD = 2;
/** The record matched the word somewhere else. */
export const RELEVANCE_ELSEWHERE = 1;

/** Whether a sorting entry is the relevance key. */
export const isRelevance = (property: unknown): property is Relevance =>
  property === RELEVANCE;

/**
 * The words a request asks for: the value of every `like` in its filtering,
 * through arrays and groups. A record a page holds matched each of them.
 */
export const relevanceTerms = <TEntity extends Entity>(
  filtering: readonly EntityFiltering<TEntity>[] | undefined,
): string[] => {
  const terms: string[] = [];
  const walk = (node: unknown): void => {
    if (Array.isArray(node)) {
      node.forEach(walk);
      return;
    }
    if (typeof node !== 'object' || node === null) return;
    const { operator, value, values } = node as {
      readonly operator?: unknown;
      readonly value?: unknown;
      readonly values?: unknown;
    };
    if (operator === 'like' && typeof value === 'string' && value !== '') {
      terms.push(value);
      return;
    }
    if (Array.isArray(values) && (operator === 'and' || operator === 'or'))
      values.forEach(walk);
  };
  walk(filtering);
  return terms;
};

/**
 * How well a label answers the words: for each word, {@link RELEVANCE_PREFIX}
 * when the label starts with it, {@link RELEVANCE_WORD} when a word of the
 * label does, {@link RELEVANCE_ELSEWHERE} otherwise — accent- and case-blind,
 * as `like` is. No label, or no words, scores nothing, so the sort falls to
 * the entries after it.
 */
export const relevanceScore = (
  label: unknown,
  terms: readonly string[],
): number => {
  if (typeof label !== 'string' || terms.length === 0) return 0;
  const folded = foldText(label);
  return terms.reduce((score, term) => {
    const word = foldText(term);
    if (folded.startsWith(word)) return score + RELEVANCE_PREFIX;
    if (folded.includes(` ${word}`)) return score + RELEVANCE_WORD;
    return score + RELEVANCE_ELSEWHERE;
  }, 0);
};

/**
 * The stored key of the member a store scores relevance against — the
 * entity's `labelMember`, under its wire alias — or `undefined` when the
 * entity declares none, which scores every record alike.
 */
export const relevanceLabelKey = <TEntity extends Entity>(
  entityConstructor: EntityConstructor<TEntity>,
): string | undefined => {
  const labelMember = findMetaEntity(entityConstructor)?.labelMember;
  return labelMember === undefined
    ? undefined
    : describeEntityColumns(entityConstructor).find(
        column => column.name === labelMember,
      )?.key;
};
