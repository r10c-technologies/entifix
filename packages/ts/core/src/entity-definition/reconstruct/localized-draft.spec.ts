import { describe, expect, it } from 'vitest';

import type { Entity, EntityId } from '../../types/Entity.js';
import { readLocalizedDraft } from '../../types/EntityDraft.js';
import { accessor } from '../decorators/accessor/index.js';
import { entity } from '../decorators/entity/index.js';
import { describeEntityColumns } from '../describe/index.js';
import { coerceLocalizedDraft } from './coerce-field-value.js';
import { reconstructEntity } from './reconstruct-entity.js';

@entity({ key: 'dish' })
class Dish implements Entity {
  #id?: EntityId;
  #name?: Readonly<Record<string, string>>;
  #note?: Readonly<Record<string, string>> = { en: 'kept' };

  @accessor({ type: 'id' })
  get id(): EntityId {
    return this.#id;
  }
  set id(value: EntityId) {
    this.#id = value;
  }

  @accessor({ type: 'localized' })
  get name(): Readonly<Record<string, string>> | undefined {
    return this.#name;
  }
  set name(value: Readonly<Record<string, string>> | undefined) {
    this.#name = value;
  }

  @accessor({ type: 'localized', readonly: true })
  get note(): Readonly<Record<string, string>> | undefined {
    return this.#note;
  }
  set note(value: Readonly<Record<string, string>> | undefined) {
    this.#note = value;
  }
}

describe('a localized member', () => {
  it('is queryable by default, one locale at a time', () => {
    const name = describeEntityColumns(Dish).find(
      column => column.name === 'name',
    );
    expect(name).toMatchObject({ filterable: true, sortable: true });
  });
});

describe('readLocalizedDraft', () => {
  it('reads a text per locale, and an empty map for any other shape', () => {
    expect(
      readLocalizedDraft({ name: { en: 'a', es: 1 as never } }, 'name'),
    ).toEqual({ en: 'a' });
    expect(readLocalizedDraft({ name: 'a' }, 'name')).toEqual({});
    expect(readLocalizedDraft({ name: [] }, 'name')).toEqual({});
    expect(readLocalizedDraft(undefined, 'name')).toEqual({});
  });
});

describe('coerceLocalizedDraft', () => {
  it('keeps the locales that hold text, and nothing when none does', () => {
    expect(coerceLocalizedDraft({ en: 'Soup', es: ' ' })).toEqual({
      en: 'Soup',
    });
    expect(coerceLocalizedDraft({ en: '', es: '' })).toBeUndefined();
  });
});

describe('reconstructEntity', () => {
  it('rebuilds a localized member from its per-locale draft', () => {
    const dish = reconstructEntity(Dish, {
      id: 'd-1',
      name: { en: 'Soup', es: 'Sopa' },
      note: { en: 'overwritten?' },
    });

    expect(dish.name).toEqual({ en: 'Soup', es: 'Sopa' });
    // A read-only member is never written back from a draft.
    expect(dish.note).toEqual({ en: 'kept' });
  });
});
