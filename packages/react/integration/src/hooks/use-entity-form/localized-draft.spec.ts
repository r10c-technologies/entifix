import {
  accessor,
  defineLocales,
  describeEntityColumns,
  type Entity,
  entity,
  type EntityId,
  reconstructEntity,
  resetLocales,
} from '@entifix/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  DEFAULT_VALIDATION_MESSAGES,
  restoreEntityDraft,
  seedEntityDraft,
  validateEntityDraft,
} from './use-entity-form.helpers.js';

@entity({ key: 'dish' })
class Dish implements Entity {
  #id?: EntityId;
  #name?: Readonly<Record<string, string>>;
  #note?: Readonly<Record<string, string>>;

  @accessor({ type: 'id' })
  get id(): EntityId {
    return this.#id;
  }
  set id(value: EntityId) {
    this.#id = value;
  }

  @accessor({ type: 'localized', label: 'Name', required: true })
  get name(): Readonly<Record<string, string>> | undefined {
    return this.#name;
  }
  set name(value: Readonly<Record<string, string>> | undefined) {
    this.#name = value;
  }

  @accessor({ type: 'localized', label: 'Note' })
  get note(): Readonly<Record<string, string>> | undefined {
    return this.#note;
  }
  set note(value: Readonly<Record<string, string>> | undefined) {
    this.#note = value;
  }
}

const descriptors = describeEntityColumns(Dish);

const dish = (name?: Record<string, string>, note?: unknown) => {
  const value = new Dish();
  value.id = 'd-1';
  value.name = name;
  value.note = note as Record<string, string> | undefined;
  return value;
};

beforeEach(() => defineLocales({ locales: ['en', 'es'], defaultLocale: 'en' }));
afterEach(() => resetLocales());

describe('a localized member in the form', () => {
  it('seeds one input per declared locale, empty where the record has none', () => {
    expect(seedEntityDraft(descriptors, dish({ en: 'Soup' }, 'junk'))).toEqual({
      id: 'd-1',
      name: { en: 'Soup', es: '' },
      note: { en: '', es: '' },
    });
  });

  it('round-trips through the draft to the same value', () => {
    const draft = seedEntityDraft(
      descriptors,
      dish({ en: 'Soup', es: 'Sopa' }),
    );
    expect(reconstructEntity(Dish, draft).name).toEqual({
      en: 'Soup',
      es: 'Sopa',
    });
  });

  it('is required as a whole, and complete once any locale is written', () => {
    const validate = (name: object, note: object) =>
      validateEntityDraft(
        descriptors,
        { id: 'd-1', name: name as never, note: note as never },
        DEFAULT_VALIDATION_MESSAGES,
      );

    expect(validate({ en: '', es: ' ' }, { en: '', es: '' })).toEqual({
      name: 'validation.required:Name',
    });
    expect(validate({ en: 'Soup', es: '' }, { en: '', es: 'Nota' })).toEqual({
      name: 'validation.locale:Name:es',
      note: 'validation.locale:Note:en',
    });
    expect(validate({ en: 'Soup', es: 'Sopa' }, {})).toEqual({});
  });

  it('restores a saved text per locale over the seed, and ignores another shape', () => {
    const seed = seedEntityDraft(descriptors, dish());
    expect(
      restoreEntityDraft(descriptors, seed, {
        name: { en: 'Soup' },
        note: 'not a map',
      }),
    ).toEqual({ ...seed, name: { en: 'Soup', es: '' } });
  });

  it('words a missing locale as a catalog key by default', () => {
    expect(DEFAULT_VALIDATION_MESSAGES.locale('Name', 'es')).toBe(
      'validation.locale:Name:es',
    );
  });
});
