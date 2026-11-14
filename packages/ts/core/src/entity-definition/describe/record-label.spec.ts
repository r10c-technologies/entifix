import { describe, expect, it } from 'vitest';

import {
  accessor,
  describeChildColumns,
  describeEntityColumns,
  type Entity,
  entity,
  type EntityId,
  entityReferenceKey,
  recordLabel,
  shortId,
} from '../../index.js';

/** A record's values, read by every getter below. */
class Values implements Entity {
  constructor(readonly values: Record<string, unknown> = {}) {}
  protected read(name: string): never {
    return this.values[name] as never;
  }
  get id(): EntityId {
    return this.read('id');
  }
}

@entity({ domain: 'shipping', key: 'shipment', labelMember: 'offeringId' })
class Shipment extends Values implements Entity {
  @accessor({ type: 'id' })
  override get id(): EntityId {
    return this.read('id');
  }
  @accessor({ type: 'string', references: { entity: 'sales:order' } })
  get orderId(): string {
    return this.read('orderId');
  }
  @accessor({ type: 'string', references: { entity: 'catalog:offering' } })
  get offeringId(): string {
    return this.read('offeringId');
  }
  @accessor({ type: 'enum', enumValues: ['open', 'sent'] })
  get status(): string {
    return this.read('status');
  }
}

/** Undeclared: the first filled-in member that is not a key. */
@entity({ domain: 'shipping', key: 'parcel' })
class Parcel extends Values implements Entity {
  @accessor({ type: 'id' })
  override get id(): EntityId {
    return this.read('id');
  }
  @accessor({ type: 'string', references: { entity: 'sales:order' } })
  get orderId(): string {
    return this.read('orderId');
  }
  @accessor({ type: 'link' })
  get carrier(): unknown {
    return this.read('carrier');
  }
  @accessor({ type: 'scalarCollection' })
  get tags(): unknown {
    return this.read('tags');
  }
  @accessor({ type: 'localized' })
  get title(): unknown {
    return this.read('title');
  }
  @accessor({ type: 'number' })
  get weight(): number {
    return this.read('weight');
  }
}

/** Declares its card's title rather than a label member. */
@entity({ key: 'carded' })
class Carded extends Values implements Entity {
  @accessor({ type: 'id' })
  override get id(): EntityId {
    return this.read('id');
  }
  @accessor({ type: 'string' })
  get code(): string {
    return this.read('code');
  }
  @accessor({ type: 'string', card: 'title' })
  get name(): string {
    return this.read('name');
  }
}

describe('references and labelMember, described', () => {
  it('carries a reference on its descriptor, and nothing on the rest', () => {
    const columns = describeEntityColumns(Shipment);
    const by = (name: string) => columns.find(column => column.name === name);
    expect(by('offeringId')?.references).toEqual({
      entity: 'catalog:offering',
    });
    expect(by('status')).not.toHaveProperty('references');
  });

  it('describes a reference on a composition row too', () => {
    class Line extends Values {
      @accessor({ type: 'string', references: { entity: 'catalog:offering' } })
      get offeringId(): string {
        return this.read('offeringId');
      }
    }
    expect(describeChildColumns(Line)[0]?.references?.entity).toBe(
      'catalog:offering',
    );
  });

  it('refuses a reference on a member that cannot hold an id', () => {
    @entity({ key: 'bad' })
    class Bad extends Values implements Entity {
      @accessor({ type: 'number', references: { entity: 'a:b' } })
      get count(): number {
        return this.read('count');
      }
    }
    expect(() => describeEntityColumns(Bad)).toThrow(/is a number/);
  });

  it('refuses a malformed key', () => {
    for (const key of ['offering', 'Catalog:Offering', 'a:b:c', ':b', 'a:']) {
      @entity({ key: 'bad' })
      class Bad extends Values implements Entity {
        @accessor({ type: 'string', references: { entity: key } })
        get target(): string {
          return this.read('target');
        }
      }
      expect(() => describeEntityColumns(Bad)).toThrow(/domain:key/);
    }
  });

  it('refuses a reference beside parent', () => {
    @entity({ key: 'bad' })
    class Bad extends Values implements Entity {
      @accessor({
        type: 'string',
        parent: true,
        references: { entity: 'a:b' },
      })
      get parentId(): string {
        return this.read('parentId');
      }
    }
    expect(() => describeEntityColumns(Bad)).toThrow(/parent member/);
  });

  it('refuses a labelMember that is missing, hidden or a collection', () => {
    @entity({ key: 'missing', labelMember: 'nope' })
    class Missing extends Values implements Entity {
      @accessor({ type: 'string' })
      get name(): string {
        return this.read('name');
      }
    }
    @entity({ key: 'hidden', labelMember: 'secret' })
    class Hidden extends Values implements Entity {
      @accessor({ type: 'string', hidden: true })
      get secret(): string {
        return this.read('secret');
      }
    }
    @entity({ key: 'many', labelMember: 'tags' })
    class Many extends Values implements Entity {
      @accessor({ type: 'scalarCollection' })
      get tags(): unknown {
        return this.read('tags');
      }
    }
    expect(() => describeEntityColumns(Missing)).toThrow(/not a member/);
    expect(() => describeEntityColumns(Hidden)).toThrow(/is hidden/);
    expect(() => describeEntityColumns(Many)).toThrow(/scalarCollection/);
  });

  it('accepts a labelMember that is a string, a number or a reference', () => {
    expect(() => describeEntityColumns(Shipment)).not.toThrow();
    @entity({ key: 'numbered', labelMember: 'number' })
    class Numbered extends Values implements Entity {
      @accessor({ type: 'number' })
      get number(): number {
        return this.read('number');
      }
    }
    expect(() => describeEntityColumns(Numbered)).not.toThrow();
  });
});

describe('recordLabel', () => {
  const uuid = '79ce50c8-0a1b-4c2d-8e3f-1234567890ab';

  it('answers a reference labelMember as a reference to resolve', () => {
    const label = recordLabel(
      Shipment,
      new Shipment({ id: uuid, orderId: uuid, offeringId: 'offering-10' }),
    );
    expect(label).toMatchObject({
      kind: 'reference',
      entity: 'catalog:offering',
      id: 'offering-10',
    });
  });

  it('skips the declared member while it is empty, and never lands on a key', () => {
    const label = recordLabel(Shipment, { id: uuid, orderId: uuid });
    expect(label).toEqual({ kind: 'fallback', shortId: '79ce50c8' });
  });

  it('takes the first filled-in member that is not a key when nothing is declared', () => {
    const base = {
      id: uuid,
      orderId: uuid,
      carrier: { id: 'c-1' },
      tags: ['fragile'],
    };
    expect(
      recordLabel(Parcel, { ...base, title: { en: 'Books' } }),
    ).toMatchObject({ kind: 'value', value: { en: 'Books' } });
    expect(
      recordLabel(Parcel, { ...base, title: { en: '' }, weight: 3 }),
    ).toMatchObject({ kind: 'value', member: { name: 'weight' }, value: 3 });
  });

  it('reads a card title as the declared label', () => {
    expect(recordLabel(Carded, { code: 'X-1', name: 'Flange' })).toMatchObject({
      kind: 'value',
      value: 'Flange',
    });
  });

  it('falls back to the noun alone when the record has no id yet', () => {
    expect(recordLabel(Parcel, {})).toEqual({ kind: 'fallback' });
    expect(recordLabel(Parcel, { id: '' })).toEqual({ kind: 'fallback' });
  });

  it('never quotes more of an id than the short form', () => {
    expect(shortId(uuid)).toHaveLength(8);
    expect(shortId('offering-12')).toBe('offering-12');
    expect(shortId('offering-1234')).toBe('offering');
  });
});

describe('entityReferenceKey', () => {
  it('is the domain:key pair the entity declares', () => {
    expect(entityReferenceKey(Shipment)).toBe('shipping:shipment');
  });

  it('refuses an entity without a domain', () => {
    expect(() => entityReferenceKey(Carded)).toThrow(/domain and a key/);
  });
});
