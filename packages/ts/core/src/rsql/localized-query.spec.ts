import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { accessor } from '../entity-definition/decorators/accessor/index.js';
import { entity } from '../entity-definition/decorators/entity/index.js';
import { defineLocales, resetLocales } from '../i18n/locales.js';
import type { Entity, EntityId } from '../types/Entity.js';
import { coerceFiltering } from './coerce-rsql.js';
import { parseRsql } from './parse-rsql.js';
import { parseSort } from './sort-param.js';

@entity({ key: 'dish' })
class Dish implements Entity {
  @accessor({ type: 'id' })
  get id(): EntityId {
    return undefined;
  }
  @accessor({ type: 'localized', alias: 'dish_name' })
  get name(): Readonly<Record<string, string>> | undefined {
    return undefined;
  }
}

beforeEach(() => defineLocales({ locales: ['en', 'es'], defaultLocale: 'en' }));
afterEach(() => resetLocales());

describe('querying a localized member', () => {
  it('filters one locale, through its wire key', () => {
    expect(coerceFiltering(Dish, parseRsql('name.es=like=sopa'))).toEqual({
      operator: 'and',
      values: [{ property: 'dish_name.es', operator: 'like', value: 'sopa' }],
    });
  });

  it('sorts by one locale', () => {
    expect(parseSort(Dish, '-name.en')).toEqual([
      { 0: { property: 'dish_name.en', type: 'desc' } },
    ]);
  });

  it('refuses the bare member, naming the path to use', () => {
    expect(() => coerceFiltering(Dish, parseRsql('name==Soup'))).toThrow(
      /"name" is localized; name one locale, as "name.<locale>"/,
    );
    expect(() => parseSort(Dish, 'name')).toThrow(/"name" is localized/);
  });

  it('refuses a locale the host did not declare', () => {
    expect(() => coerceFiltering(Dish, parseRsql('name.fr==Soupe'))).toThrow(
      /"fr" is not a declared locale/,
    );
  });

  it('refuses a path into a member that is not localized', () => {
    expect(() => coerceFiltering(Dish, parseRsql('id.en==x'))).toThrow(
      /"id.en" is not a filterable member/,
    );
    expect(() => parseSort(Dish, 'nothing')).toThrow(
      /"nothing" is not a sortable member/,
    );
  });
});
