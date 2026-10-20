import {
  accessor,
  describeEntityColumns,
  type Entity,
  entity,
  type EntityDraft,
  type EntityId,
  ROW_KEY,
} from '@entifix/core';
import { describe, expect, it } from 'vitest';

import {
  DEFAULT_VALIDATION_MESSAGES,
  type EntityDraftMessages,
  validateEntityDraft,
} from './use-entity-form.helpers.js';

class Step {
  @accessor({ type: 'string' })
  get text(): string {
    return '';
  }
}

@entity({ key: 'trip' })
class Trip implements Entity {
  @accessor({ type: 'id' })
  get id(): EntityId {
    return undefined;
  }
  @accessor({
    type: 'scalarCollection',
    label: 'Tags',
    minItems: 1,
    maxItems: 2,
  })
  get tags(): readonly string[] {
    return [];
  }
  @accessor({ type: 'linkCollection', label: 'Stops', maxItems: 1 })
  get stops(): readonly string[] {
    return [];
  }
  @accessor({
    type: 'composition',
    label: 'Steps',
    minItems: 2,
    maxItems: 3,
    childType: () => Step,
  })
  get steps(): readonly Step[] {
    return [];
  }
  @accessor({ type: 'date', label: 'Start' })
  get start(): Date | undefined {
    return undefined;
  }
  @accessor({ type: 'date', label: 'End', notBefore: 'start' })
  get end(): Date | undefined {
    return undefined;
  }
}

const descriptors = describeEntityColumns(Trip);

const messages: EntityDraftMessages = {
  ...DEFAULT_VALIDATION_MESSAGES,
  minItems: (field, count) => `${field} needs ${count}`,
  maxItems: (field, count) => `${field} takes ${count}`,
  notBefore: (field, other) => `${field} before ${other}`,
  locale: (field, locale) => `${field} lacks ${locale}`,
};

const step = (key: string) => ({ [ROW_KEY]: key, text: 'x' });

const valid: EntityDraft = {
  id: 't-1',
  tags: 'a',
  stops: '',
  steps: [step('1'), step('2')],
  start: '2026-01-01',
  end: '2026-01-02',
};

const errorsOf = (over: EntityDraft) =>
  validateEntityDraft(descriptors, { ...valid, ...over }, messages);

describe('validateEntityDraft — declared constraints', () => {
  it('passes a draft inside every bound', () => {
    expect(errorsOf({})).toEqual({});
  });

  it('counts a comma list, blanks aside, empty included', () => {
    expect(errorsOf({ tags: '' })).toEqual({ tags: 'Tags needs 1' });
    expect(errorsOf({ tags: 'a, ,b,c' })).toEqual({ tags: 'Tags takes 2' });
    expect(errorsOf({ tags: 'a, ,b' })).toEqual({});
  });

  it('counts a link collection by its ids, though it never judges one', () => {
    expect(errorsOf({ stops: 'p-1,p-2' })).toEqual({ stops: 'Stops takes 1' });
  });

  it('counts the rows a composition holds', () => {
    expect(errorsOf({ steps: [step('1')] })).toEqual({
      steps: 'Steps needs 2',
    });
    expect(
      errorsOf({ steps: [step('1'), step('2'), step('3'), step('4')] }),
    ).toEqual({ steps: 'Steps takes 3' });
  });

  it('refuses a date before the one it names, and judges nothing half filled', () => {
    expect(errorsOf({ end: '2025-12-31' })).toEqual({
      end: 'End before Start',
    });
    expect(errorsOf({ start: '', end: '2025-12-31' })).toEqual({});
    expect(errorsOf({ start: 'soon', end: '2025-12-31' })).toEqual({
      start: 'validation.date:Start',
    });
  });

  it('spells its defaults as catalog keys', () => {
    expect(DEFAULT_VALIDATION_MESSAGES.minItems('Tags', 1)).toBe(
      'validation.minItems:Tags:1',
    );
    expect(DEFAULT_VALIDATION_MESSAGES.maxItems('Tags', 2)).toBe(
      'validation.maxItems:Tags:2',
    );
    expect(DEFAULT_VALIDATION_MESSAGES.notBefore('End', 'Start')).toBe(
      'validation.notBefore:End:Start',
    );
  });
});
