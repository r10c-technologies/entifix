import {
  accessor,
  COLLECTION_TYPES,
  describeEntityColumns,
  Entity,
  entity,
  EntityCollectionLink,
  EntityId,
  EntityLink,
  MetaAccessorType,
  MetaAccessorTypes,
  SCALAR_TYPES,
} from '../../index.js';

@entity({ key: 'brand' })
class Brand implements Entity {
  #id?: EntityId;
  #name?: string;

  @accessor({ type: 'id' })
  get id(): EntityId {
    return this.#id;
  }
  set id(value: EntityId) {
    this.#id = value;
  }

  @accessor({ type: 'string' })
  get name(): string | undefined {
    return this.#name;
  }
  set name(value: string | undefined) {
    this.#name = value;
  }
}

@entity({ key: 'article' })
class Article implements Entity {
  #id?: EntityId;
  #productCode?: string;
  #stock = 0;
  #releasedAt?: Date;
  #secret?: string;
  #internalNote?: string;
  #brand = new EntityLink(Brand);

  @accessor({ type: 'id', order: 0 })
  get id(): EntityId {
    return this.#id;
  }
  set id(value: EntityId) {
    this.#id = value;
  }

  // Undeclared type + no label: both are derived.
  @accessor()
  get productCode(): string | undefined {
    return this.#productCode;
  }
  set productCode(value: string | undefined) {
    this.#productCode = value;
  }

  @accessor({
    type: 'number',
    label: 'Units in stock',
    labelKey: 'entity:widget.fields.stock',
    order: 10,
    required: true,
  })
  get stock(): number {
    return this.#stock;
  }
  set stock(value: number) {
    this.#stock = value;
  }

  @accessor({ type: 'date' })
  get releasedAt(): Date | undefined {
    return this.#releasedAt;
  }
  set releasedAt(value: Date | undefined) {
    this.#releasedAt = value;
  }

  @accessor({ hidden: true })
  get secret(): string | undefined {
    return this.#secret;
  }
  set secret(value: string | undefined) {
    this.#secret = value;
  }

  // Read-only members are still displayable — unlike serialization, which skips
  // them.
  @accessor({ readonly: true, type: 'string' })
  get internalNote(): string | undefined {
    return this.#internalNote;
  }

  @accessor({ type: 'link', linkLabelProperty: 'name' })
  get brand(): EntityLink<Brand> {
    return this.#brand;
  }
}

describe('describeEntityColumns', () => {
  const columns = describeEntityColumns(Article);
  const byName = (name: string) => columns.find(column => column.name === name);

  it('skips hidden accessors and keeps read-only ones', () => {
    expect(byName('secret')).toBeUndefined();
    expect(byName('internalNote')).toBeDefined();
  });

  it('emits one descriptor per getter, deduped against its setter', () => {
    expect(columns.filter(column => column.name === 'stock')).toHaveLength(1);
  });

  it('humanizes the label when none is declared', () => {
    expect(byName('productCode')?.label).toBe('Product Code');
  });

  it('prefers the declared label', () => {
    expect(byName('stock')?.label).toBe('Units in stock');
  });

  // Core has no locale and no catalogs, and the same descriptor feeds the
  // server-side filter allowlist — so the key is carried, never resolved here.
  it('carries the label key through untouched, leaving `label` as the fallback', () => {
    expect(byName('stock')?.labelKey).toBe('entity:widget.fields.stock');
    expect(byName('stock')?.label).toBe('Units in stock');
    expect(byName('productCode')?.labelKey).toBeUndefined();
  });

  it('sorts by declared order, falling back to declaration order', () => {
    expect(columns.map(column => column.name)).toEqual([
      'id',
      'productCode',
      'releasedAt',
      'internalNote',
      'brand',
      'stock',
    ]);
  });

  it('defaults sortable/filterable on for scalars and off for id and links', () => {
    expect(byName('stock')).toMatchObject({ sortable: true, filterable: true });
    expect(byName('id')).toMatchObject({ sortable: false, filterable: false });
    expect(byName('brand')).toMatchObject({
      sortable: false,
      filterable: false,
    });
  });

  it('falls back to string when a type is neither declared nor inferable', () => {
    expect(byName('productCode')?.type).toBe('string');
  });

  it('surfaces readonly and required flags, defaulting both to false', () => {
    expect(byName('internalNote')?.readonly).toBe(true);
    expect(byName('stock')?.readonly).toBe(false);
    expect(byName('stock')?.required).toBe(true);
    expect(byName('productCode')?.required).toBe(false);
  });

  // You search for what you read, so the search property follows the label one
  // unless a member says otherwise; a relation writes back its key by default,
  // because that is the shape that does not depend on what the UI loaded.
  it('defaults a link’s search property to its label property, and travel to id', () => {
    expect(byName('brand')).toMatchObject({
      linkLabelProperty: 'name',
      linkSearchProperty: 'name',
      linkSerialization: 'id',
    });
  });

  it('honours declared link search and serialization overrides', () => {
    @entity({ key: 'declared-link' })
    class DeclaredLink implements Entity {
      #id?: EntityId;
      #brand = new EntityLink(Brand);

      @accessor()
      get id(): EntityId {
        return this.#id;
      }
      set id(value: EntityId) {
        this.#id = value;
      }

      @accessor({
        type: 'link',
        linkLabelProperty: 'title',
        linkSearchProperty: 'code',
        linkSerialization: 'embedded',
      })
      get brand(): EntityLink<Brand> {
        return this.#brand;
      }
    }

    expect(
      describeEntityColumns(DeclaredLink).find(
        column => column.name === 'brand',
      ),
    ).toMatchObject({
      linkLabelProperty: 'title',
      linkSearchProperty: 'code',
      linkSerialization: 'embedded',
    });
  });
});

describe('describeEntityColumns type inference', () => {
  @entity({ key: 'bare' })
  class Bare implements Entity {
    #id?: EntityId;
    #count = 0;
    #active = false;
    #createdAt = new Date();
    #brand = new EntityLink(Brand);
    #brands = new EntityCollectionLink(Brand);

    @accessor()
    get id(): EntityId {
      return this.#id;
    }
    set id(value: EntityId) {
      this.#id = value;
    }

    @accessor()
    get count(): number {
      return this.#count;
    }

    @accessor()
    get active(): boolean {
      return this.#active;
    }

    @accessor()
    get createdAt(): Date {
      return this.#createdAt;
    }

    @accessor()
    get brand(): EntityLink<Brand> {
      return this.#brand;
    }

    @accessor()
    get brands(): EntityCollectionLink<Brand> {
      return this.#brands;
    }
  }

  it('reads the type off a sample value', () => {
    const columns = describeEntityColumns(Bare, new Bare());
    const types = Object.fromEntries(
      columns.map(column => [column.name, column.type]),
    );

    expect(types).toEqual({
      id: 'id',
      count: 'number',
      active: 'boolean',
      createdAt: 'date',
      brand: 'link',
      brands: 'linkCollection',
    });
  });
});

describe('describeEntityColumns deduplication', () => {
  // Subclass metadata inherits the parent's accessor list, so re-decorating an
  // overridden member registers it twice. The first entry — the subclass's own,
  // appended last but reached first via the inherited array — must not produce a
  // duplicate column.
  @entity({ key: 'base-widget' })
  class BaseWidget implements Entity {
    #id?: EntityId;
    #label?: string;

    @accessor({ type: 'id' })
    get id(): EntityId {
      return this.#id;
    }
    set id(value: EntityId) {
      this.#id = value;
    }

    @accessor({ label: 'Base label' })
    get label(): string | undefined {
      return this.#label;
    }
    set label(value: string | undefined) {
      this.#label = value;
    }
  }

  @entity({ key: 'special-widget' })
  class SpecialWidget extends BaseWidget {
    @accessor({ label: 'Special label' })
    override get label(): string | undefined {
      return super.label;
    }
    override set label(value: string | undefined) {
      super.label = value;
    }
  }

  it('emits one column per name even when a member is redeclared', () => {
    const columns = describeEntityColumns(SpecialWidget);

    expect(columns.filter(column => column.name === 'label')).toHaveLength(1);
  });
});

describe('the accessor-type partition', () => {
  /**
   * Nothing in the repo guards `MetaAccessorType` exhaustively: every switch
   * over it — `coerceValue`, `formatByType`, `coerceFieldValue` — carries a
   * `default` that treats the value as a string. So an eleventh type would
   * compile, render as `String(value)` and be silently unqueryable-by-accident
   * rather than by decision.
   *
   * This is what makes that impossible. Adding a type without classifying it
   * fails here, and the classification is the thing every other site reads.
   */
  it('classifies every declared type exactly once', () => {
    const REFERENCE_TYPES: MetaAccessorType[] = ['id', 'link'];
    // One object queried a locale at a time: neither a scalar nor a collection.
    const LOCALIZED_TYPES: MetaAccessorType[] = ['localized'];
    const classified = [
      ...SCALAR_TYPES,
      ...COLLECTION_TYPES,
      ...REFERENCE_TYPES,
      ...LOCALIZED_TYPES,
    ];

    expect([...classified].sort()).toEqual([...MetaAccessorTypes].sort());
    expect(new Set(classified).size).toBe(classified.length);
  });

  it('defaults every collection to unqueryable', () => {
    @entity({ key: 'basket' })
    class Basket implements Entity {
      #id?: EntityId;
      #tags: readonly string[] = [];
      #lines: readonly object[] = [];

      @accessor({ type: 'id' })
      get id(): EntityId {
        return this.#id;
      }
      set id(value: EntityId) {
        this.#id = value;
      }

      @accessor({ type: 'scalarCollection' })
      get tags(): readonly string[] {
        return this.#tags;
      }
      set tags(value: readonly string[]) {
        this.#tags = value;
      }

      @accessor({ type: 'composition', childType: () => Brand })
      get lines(): readonly object[] {
        return this.#lines;
      }
      set lines(value: readonly object[]) {
        this.#lines = value;
      }
    }

    const columns = describeEntityColumns(Basket);
    const tags = columns.find(column => column.name === 'tags');
    const lines = columns.find(column => column.name === 'lines');

    expect(tags).toMatchObject({ sortable: false, filterable: false });
    expect(lines).toMatchObject({ sortable: false, filterable: false });
  });

  it('resolves a composition child constructor from its thunk', () => {
    @entity({ key: 'crate' })
    class Crate implements Entity {
      #id?: EntityId;
      #lines: readonly object[] = [];

      @accessor({ type: 'id' })
      get id(): EntityId {
        return this.#id;
      }
      set id(value: EntityId) {
        this.#id = value;
      }

      @accessor({ type: 'composition', childType: () => Brand })
      get lines(): readonly object[] {
        return this.#lines;
      }
      set lines(value: readonly object[]) {
        this.#lines = value;
      }
    }

    const lines = describeEntityColumns(Crate).find(
      column => column.name === 'lines',
    );

    expect(lines?.childType).toBe(Brand);
    // The child is described by the very same walk — that is the whole
    // mechanism, and the reason a child needs no `@entity()` and no `id`.
    expect(describeEntityColumns(lines?.childType ?? Brand)).not.toHaveLength(
      0,
    );
  });

  it.each([
    ['sortable', { type: 'scalarCollection', sortable: true }],
    ['filterable', { type: 'composition', filterable: true }],
  ] as const)('throws when a collection is declared %s', (_which, options) => {
    @entity({ key: 'bad-bag' })
    class BadBag implements Entity {
      #id?: EntityId;
      #many: readonly string[] = [];

      @accessor({ type: 'id' })
      get id(): EntityId {
        return this.#id;
      }
      set id(value: EntityId) {
        this.#id = value;
      }

      @accessor(options)
      get many(): readonly string[] {
        return this.#many;
      }
      set many(value: readonly string[]) {
        this.#many = value;
      }
    }

    expect(() => describeEntityColumns(BadBag)).toThrow(Error);
  });

  /**
   * There is deliberately no inference for either collection type: an empty
   * array is indistinguishable from an empty `string[]`, so guessing would be
   * wrong exactly when a record has no rows yet. A collection must be declared,
   * and an undeclared array member keeps the old `string` fallback rather than
   * silently changing shape.
   */
  it('does not infer a collection from a sample', () => {
    @entity({ key: 'sack' })
    class Sack implements Entity {
      #id?: EntityId;
      #things: readonly string[] = ['a'];

      @accessor({ type: 'id' })
      get id(): EntityId {
        return this.#id;
      }
      set id(value: EntityId) {
        this.#id = value;
      }

      @accessor()
      get things(): readonly string[] {
        return this.#things;
      }
      set things(value: readonly string[]) {
        this.#things = value;
      }
    }

    const things = describeEntityColumns(Sack, new Sack()).find(
      column => column.name === 'things',
    );

    expect(things?.type).toBe('string');
  });
});

describe('describeEntityColumns money', () => {
  @entity({ key: 'priced' })
  class Priced implements Entity {
    #id?: EntityId;
    #price = 6499;
    #fee = 25;
    #currency = 'GTQ';

    @accessor({ type: 'id' })
    get id(): EntityId {
      return this.#id;
    }
    set id(value: EntityId) {
      this.#id = value;
    }

    @accessor({
      type: 'number',
      money: { unit: 'minor', currencyMember: 'currency' },
    })
    get price(): number {
      return this.#price;
    }
    set price(value: number) {
      this.#price = value;
    }

    @accessor({ type: 'number', money: { unit: 'major', currency: 'USD' } })
    get fee(): number {
      return this.#fee;
    }
    set fee(value: number) {
      this.#fee = value;
    }

    @accessor({ type: 'string' })
    get currency(): string {
      return this.#currency;
    }
    set currency(value: string) {
      this.#currency = value;
    }
  }

  it('carries the money reading on the descriptor, and nothing on other members', () => {
    const columns = describeEntityColumns(Priced);
    const by = (name: string) => columns.find(column => column.name === name);

    expect(by('price')?.money).toEqual({
      unit: 'minor',
      currencyMember: 'currency',
    });
    expect(by('fee')?.money).toEqual({ unit: 'major', currency: 'USD' });
    expect(by('currency')).not.toHaveProperty('money');
    // Still a number to everything else: sortable and filterable as one.
    expect(by('price')).toMatchObject({
      type: 'number',
      sortable: true,
      filterable: true,
    });
  });

  it('refuses money on a member that is not a number', () => {
    @entity({ key: 'bad-money' })
    class BadMoney implements Entity {
      #id?: EntityId;
      #label = '';

      @accessor({ type: 'id' })
      get id(): EntityId {
        return this.#id;
      }
      set id(value: EntityId) {
        this.#id = value;
      }

      @accessor({ type: 'string', money: { unit: 'major', currency: 'GTQ' } })
      get label(): string {
        return this.#label;
      }
      set label(value: string) {
        this.#label = value;
      }
    }

    expect(() => describeEntityColumns(BadMoney)).toThrow(
      /"label" is a string and declares money/,
    );
  });

  it.each([
    ['names no member', 'missing'],
    ['names a member that is not a string', 'amount'],
  ])('refuses a currency member that %s', (_label, member) => {
    @entity({ key: `bad-currency-${member}` })
    class BadCurrency implements Entity {
      #id?: EntityId;
      #amount = 1;

      @accessor({ type: 'id' })
      get id(): EntityId {
        return this.#id;
      }
      set id(value: EntityId) {
        this.#id = value;
      }

      @accessor({
        type: 'number',
        money: { unit: 'minor', currencyMember: member },
      })
      get amount(): number {
        return this.#amount;
      }
      set amount(value: number) {
        this.#amount = value;
      }
    }

    expect(() => describeEntityColumns(BadCurrency)).toThrow(
      new RegExp(`reads its currency from "${member}"`),
    );
  });
});

describe('describeEntityColumns card presentation', () => {
  @entity({ key: 'carded' })
  class Carded implements Entity {
    #id?: EntityId;
    #name = '';
    #notes = '';

    @accessor({ type: 'id' })
    get id(): EntityId {
      return this.#id;
    }
    set id(value: EntityId) {
      this.#id = value;
    }

    @accessor({ type: 'string', minWidth: 14, card: 'title' })
    get name(): string {
      return this.#name;
    }
    set name(value: string) {
      this.#name = value;
    }

    @accessor({ type: 'string', card: 'hidden', autocomplete: 'email' })
    get notes(): string {
      return this.#notes;
    }
    set notes(value: string) {
      this.#notes = value;
    }
  }

  it('carries a declared width and card role, and nothing undeclared', () => {
    const columns = describeEntityColumns(Carded);
    const by = (name: string) => columns.find(column => column.name === name);

    expect(by('name')).toMatchObject({ minWidth: 14, card: 'title' });
    expect(by('notes')).toMatchObject({
      card: 'hidden',
      autocomplete: 'email',
    });
    expect(by('notes')).not.toHaveProperty('minWidth');
    expect(by('id')).not.toHaveProperty('card');
    expect(by('name')).not.toHaveProperty('autocomplete');
  });

  it('refuses a width that is not a positive number', () => {
    for (const minWidth of [0, -2, Number.NaN]) {
      @entity({ key: 'bad-width' })
      class BadWidth implements Entity {
        #id?: EntityId;

        @accessor({ type: 'id', minWidth })
        get id(): EntityId {
          return this.#id;
        }
        set id(value: EntityId) {
          this.#id = value;
        }
      }
      expect(() => describeEntityColumns(BadWidth)).toThrow(/minWidth/);
    }
  });
});
