import { describe, expect, it } from 'vitest';

import type { Entity, EntityId } from '../../types/Entity.js';
import { accessor } from '../decorators/accessor/index.js';
import { entity } from '../decorators/entity/index.js';
import { serializeEntityCollection } from '../serializer/index.js';
import { validateRecords } from '../validate/index.js';
import { extractEntityView } from './entity-view.js';

@entity({
  key: 'post',
  views: {
    public: {
      filtering: [{ property: 'draft', operator: 'eq', value: false }],
      sorting: [{ 0: { property: 'title', type: 'asc' } }],
      omit: ['body'],
    },
    everything: {},
    broken: { omit: ['nowhere'] },
    anonymous: { omit: ['id'] },
  },
})
class Post implements Entity {
  #id?: EntityId;
  #title?: string;
  #body?: string;
  #draft = false;

  @accessor({ type: 'id' })
  get id(): EntityId {
    return this.#id;
  }
  set id(value: EntityId) {
    this.#id = value;
  }

  @accessor({ type: 'string', required: true })
  get title(): string | undefined {
    return this.#title;
  }
  set title(value: string | undefined) {
    this.#title = value;
  }

  @accessor({ type: 'string', required: true, alias: 'content' })
  get body(): string | undefined {
    return this.#body;
  }
  set body(value: string | undefined) {
    this.#body = value;
  }

  @accessor({ type: 'boolean' })
  get draft(): boolean {
    return this.#draft;
  }
  set draft(value: boolean) {
    this.#draft = value;
  }
}

const post = (id: string, title: string, draft = false) => {
  const value = new Post();
  value.id = id;
  value.title = title;
  value.body = `${title}, at length`;
  value.draft = draft;
  return value;
};

const posts = [
  post('p-1', 'Zebra'),
  post('p-2', 'Draft', true),
  post('p-3', 'Apple'),
];

describe('extractEntityView', () => {
  it('resolves a view and the members it omits', () => {
    const view = extractEntityView(Post, 'public');

    expect(view.name).toBe('public');
    expect(view.omitted.map(descriptor => descriptor.key)).toEqual(['content']);
  });

  it('refuses a view the entity does not declare, naming the ones it does', () => {
    expect(() => extractEntityView(Post, 'secret')).toThrow(
      /Post declares no view "secret"; it declares \["public","everything","broken","anonymous"\]/,
    );
  });

  it('refuses to omit a member the entity lacks, or its identity', () => {
    expect(() => extractEntityView(Post, 'broken')).toThrow(
      /omits "nowhere", which is not a member of it/,
    );
    expect(() => extractEntityView(Post, 'anonymous')).toThrow(
      /omits "id", which is its identity/,
    );
  });

  it('refuses a view on an entity that declares none', () => {
    @entity({ key: 'plain' })
    class Plain implements Entity {
      id: EntityId;
    }
    expect(() => extractEntityView(Plain, 'public')).toThrow(
      /Plain declares no view "public"; it declares \[\]/,
    );
  });
});

describe('serializeEntityCollection through a view', () => {
  it('keeps the records it filters, in its order, without what it omits', () => {
    expect(serializeEntityCollection(Post, posts, { view: 'public' })).toEqual([
      { id: 'p-3', title: 'Apple', draft: false },
      { id: 'p-1', title: 'Zebra', draft: false },
    ]);
  });

  it('publishes every record whole through an empty view, as without one', () => {
    expect(
      serializeEntityCollection(Post, posts, { view: 'everything' }),
    ).toEqual(serializeEntityCollection(Post, posts));
  });
});

describe('validateRecords against a view', () => {
  it('does not require what the view omitted, and still requires the rest', () => {
    const published = serializeEntityCollection(Post, posts, {
      view: 'public',
    });

    expect(
      validateRecords(Post, published, { view: 'public' }).problems,
    ).toEqual([]);
    expect(
      validateRecords(Post, [{ id: 'p-9' }], { view: 'public' }).problems,
    ).toEqual([
      { path: 'p-9 › title', message: 'is required, and is missing' },
    ]);
    expect(validateRecords(Post, published).problems).toHaveLength(2);
  });
});
