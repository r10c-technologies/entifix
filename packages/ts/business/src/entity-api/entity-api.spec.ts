import {
  accessor,
  type Entity,
  entity,
  type EntityId,
  useCase,
} from '@entifix/core';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { defineEntityApi, verbEndpoint } from './entity-api.js';

@entity({ domain: 'catalog', key: 'widget' })
class Widget implements Entity {
  #id?: EntityId;

  @accessor({ type: 'id' })
  get id(): EntityId {
    return this.#id;
  }
  set id(value: EntityId) {
    this.#id = value;
  }
}

@useCase({
  entity: Widget,
  key: 'polish',
  binding: 'entity',
  placement: 'determining',
  labelKey: 'polish',
})
class PolishWidget {}

describe('defineEntityApi', () => {
  it('declares an entity’s endpoints as a value the shell serves', () => {
    const options = {
      verbs: ['list', 'get'],
      guard: { kind: 'public' },
    } as const;

    expect(defineEntityApi(Widget, 'widget', options)).toEqual({
      entity: Widget,
      key: 'widget',
      options,
    });
  });

  it('refuses an option it does not know, at compile time', () => {
    const declaration = defineEntityApi(Widget, 'widget', {
      verbs: ['get'],
      guard: { kind: 'public' },
      // @ts-expect-error -- the shell adds compositions when it serves
      compositions: {},
    });

    expect(declaration.key).toBe('widget');
  });
});

describe('verbEndpoint', () => {
  it('pairs a @useCase() verb with who may call it and what it does', () => {
    const handler = () => Effect.void;
    const verb = verbEndpoint(PolishWidget, {
      guard: { kind: 'permission' },
      handler,
    });

    expect(verb.useCase).toMatchObject({ key: 'polish', entity: Widget });
    expect(verb.guard).toEqual({ kind: 'permission' });
    expect(verb.handler).toBe(handler);
  });
});
