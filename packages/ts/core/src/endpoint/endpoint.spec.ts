import { Effect, Schema } from 'effect';
import { describe, expect, expectTypeOf, it } from 'vitest';

import {
  accessor,
  type Entity,
  entity,
  type EntityId,
  Failure,
  Unavailable,
} from '../index.js';
import {
  bodyEncodingOf,
  defineEndpoint,
  defineEndpoints,
  entityKey,
  formBody,
  implement,
  JsonBody,
  textBody,
} from './endpoint.js';

@entity({ domain: 'shop', key: 'basket' })
class Basket implements Entity {
  #id?: EntityId;

  @accessor()
  get id(): EntityId {
    return this.#id;
  }
  set id(value: EntityId) {
    this.#id = value;
  }
}

class BasketClosed extends Failure.conflict<BasketClosed>()(
  'SpecBasketClosed',
  'specBasketClosed',
  { basketId: Schema.String },
) {}

class BasketUnknown extends Failure.notFound<BasketUnknown>()(
  'SpecBasketUnknown',
  'specBasketUnknown',
) {}

const close = defineEndpoint({
  name: 'close',
  method: 'POST',
  path: '/api/basket/:id/close',
  params: { id: Schema.String },
  payload: Schema.Struct({ reason: Schema.String }),
  success: Schema.Struct({ closed: Schema.Boolean }),
  errors: [BasketClosed],
  guard: { kind: 'permission', permission: 'shop:basket:close' },
  idempotent: 'unit',
  useCase: 'close',
});

const ping = defineEndpoint({
  name: 'ping',
  method: 'GET',
  path: '/api/ping',
  success: Schema.String,
  errors: [],
  guard: { kind: 'public' },
});

describe('endpoint descriptors', () => {
  it('keep what they were declared with', () => {
    expect(close.path).toBe('/api/basket/:id/close');
    expect(close.guard).toEqual({
      kind: 'permission',
      permission: 'shop:basket:close',
    });
    expect(defineEndpoints(close, ping)).toEqual([close, ping]);
  });

  it('type a handler from the descriptor', async () => {
    const served = implement(close, ({ params, payload }) =>
      Effect.succeed({ closed: params.id === 'b1' && payload.reason !== '' }),
    );

    expectTypeOf(served.handler).parameter(0).toEqualTypeOf<
      { readonly params: { readonly id: string } } & {
        readonly payload: { readonly reason: string };
      }
    >();
    expect(
      await Effect.runPromise(
        served.handler({ params: { id: 'b1' }, payload: { reason: 'done' } }),
      ),
    ).toEqual({ closed: true });
  });

  it('let a handler fail with a declared or a technical failure', async () => {
    const served = implement(close, ({ params }) =>
      params.id === 'gone'
        ? Effect.fail(new Unavailable({}))
        : Effect.fail(new BasketClosed({ basketId: params.id })),
    );

    const failure = await Effect.runPromise(
      Effect.flip(
        served.handler({ params: { id: 'b1' }, payload: { reason: 'x' } }),
      ),
    );
    expect(failure).toBeInstanceOf(BasketClosed);
  });

  it('refuse, at compile time, a business failure the descriptor does not declare', () => {
    implement(
      close,
      // @ts-expect-error — BasketUnknown is not in close's errors
      () => Effect.fail(new BasketUnknown()),
    );
    implement(
      ping,
      // @ts-expect-error — ping declares no business failure at all
      () => Effect.fail(new BasketClosed({ basketId: 'b1' })),
    );
    expect(true).toBe(true);
  });

  it('give a handler of an endpoint with no inputs an empty request', async () => {
    const served = implement(ping, () => Effect.succeed('pong'));

    expect(await Effect.runPromise(served.handler({} as never))).toBe('pong');
  });
});

describe('entityKey', () => {
  it('answers the literal when it matches the entity', () => {
    const key = entityKey(Basket, 'basket');

    expectTypeOf(key).toEqualTypeOf<'basket'>();
    expect(key).toBe('basket');
  });

  it('throws at load when the literal is not the entity’s key', () => {
    expect(() => entityKey(Basket, 'cart')).toThrow(
      "entityKey(Basket, 'cart') does not match @entity({ key: 'basket' })",
    );
  });

  it('names a missing key in its refusal', () => {
    @entity({ domain: 'shop' })
    class Keyless implements Entity {
      #id?: EntityId;

      @accessor()
      get id(): EntityId {
        return this.#id;
      }
      set id(value: EntityId) {
        this.#id = value;
      }
    }

    expect(() => entityKey(Keyless, 'keyless')).toThrow(
      'does not match @entity({ key: undefined })',
    );
  });
});

describe('JsonBody', () => {
  it('sends what it is given as its JSON', () => {
    const at = new Date('2026-10-29T00:00:00.000Z');

    expect(Schema.encodeSync(JsonBody)({ at, gone: undefined, n: 1 })).toEqual({
      at: '2026-10-29T00:00:00.000Z',
      n: 1,
    });
    expect(Schema.encodeSync(JsonBody)(undefined)).toBeNull();
    expect(Schema.decodeSync(JsonBody)({ a: 1 })).toEqual({ a: 1 });
  });
});

describe('the payload encodings', () => {
  it('marks a text body and a form body, and leaves JSON unmarked', () => {
    expect(bodyEncodingOf(textBody())).toEqual({
      kind: 'text',
      contentType: 'text/plain',
    });
    expect(bodyEncodingOf(textBody('application/json'))?.contentType).toBe(
      'application/json',
    );
    expect(bodyEncodingOf(formBody({ token: Schema.String }))).toEqual({
      kind: 'form',
      contentType: 'application/x-www-form-urlencoded',
    });
    expect(bodyEncodingOf(Schema.Struct({ token: Schema.String }))).toBe(
      undefined,
    );
    expect(
      Schema.decodeSync(formBody({ token: Schema.String }))({ token: 't' }),
    ).toEqual({ token: 't' });
  });
});
