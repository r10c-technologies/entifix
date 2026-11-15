import {
  EntityRepositoryTag,
  getUCFactory,
  loadUCFactory,
} from '@entifix/business';
import { Unavailable } from '@entifix/core';
import {
  accessor,
  defineLocales,
  describeEntityColumns,
  type Entity,
  entity,
  type EntityFieldDescriptor,
  type EntityId,
  EntityLink,
  type EntityLoadRequest,
  type Locale,
  type LocalizedText,
  resetLocales,
} from '@entifix/core';
import { makeInMemoryEntityRepository } from '@entifix/testing-unit';
import { act, renderHook, waitFor } from '@testing-library/react';
import { Context } from 'effect';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { EntifixQueryProvider } from '../../query/query-provider.js';
import { useEntityLinkSource } from './use-entity-link-source.js';

@entity({ key: 'source-brand' })
class SourceBrand implements Entity {
  #id?: EntityId;
  #name?: string;
  /** Not filterable, so it cannot be searched — the guard's case. */
  #notes?: string;

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

  @accessor({ type: 'string', filterable: false })
  get notes(): string | undefined {
    return this.#notes;
  }
  set notes(value: string | undefined) {
    this.#notes = value;
  }

  /** Localized, and declared not filterable: refused in every locale. */
  @accessor({ type: 'localized', filterable: false })
  get motto(): Readonly<Record<string, string>> | undefined {
    return undefined;
  }
}

@entity({ key: 'source-widget' })
class SourceWidget implements Entity {
  #id?: EntityId;
  #brand = new EntityLink(SourceBrand);

  @accessor({ type: 'id' })
  get id(): EntityId {
    return this.#id;
  }
  set id(value: EntityId) {
    this.#id = value;
  }

  @accessor({ type: 'link', label: 'Brand' })
  get brand(): EntityLink<SourceBrand> {
    return this.#brand;
  }
}

const brandDescriptor = (
  overrides: Partial<EntityFieldDescriptor> = {},
): EntityFieldDescriptor => ({
  ...describeEntityColumns(SourceWidget).find(
    column => column.name === 'brand',
  )!,
  ...overrides,
});

const brand = (id: string, name: string): SourceBrand => {
  const instance = new SourceBrand();
  instance.id = id;
  instance.name = name;
  return instance;
};

const BRANDS = [
  brand('b-1', 'Acme'),
  brand('b-2', 'Globex'),
  brand('b-3', 'Initech'),
];

const wrapper = ({ children }: { children: ReactNode }) => (
  <EntifixQueryProvider>{children}</EntifixQueryProvider>
);

type Ctx = EntityRepositoryTag;

let repository: ReturnType<typeof makeInMemoryEntityRepository>;

const makeContext = () => Context.make(EntityRepositoryTag, repository).pipe();

/** The real use-cases over the in-memory repository — no adapter mocked out. */
const renderSource = (
  options: {
    descriptor?: EntityFieldDescriptor;
    selectedId?: EntityId;
    selectedEntity?: SourceBrand;
    withGetUc?: boolean;
    baseFiltering?: Parameters<
      typeof useEntityLinkSource<SourceBrand, Ctx>
    >[0]['baseFiltering'];
  } = {},
) =>
  renderHook(
    () =>
      useEntityLinkSource<SourceBrand, Ctx>(
        {
          entityConstructor: SourceBrand,
          loadUc: loadUCFactory<SourceBrand>(),
          ...(options.withGetUc === false
            ? {}
            : { getUc: getUCFactory<SourceBrand>() }),
          ctx: makeContext(),
          baseFiltering: options.baseFiltering,
          // Zero, so the settled term is observable without waiting on a timer.
          debounceMs: 0,
        },
        {
          descriptor: options.descriptor ?? brandDescriptor(),
          selectedId: options.selectedId,
          selectedEntity: options.selectedEntity,
        },
      ),
    { wrapper },
  );

beforeEach(() => {
  repository = makeInMemoryEntityRepository([...BRANDS]);
});

describe('useEntityLinkSource', () => {
  it('offers a first page of suggestions', async () => {
    const { result } = renderSource();

    await waitFor(() => expect(result.current.quick.isLoading).toBe(false));

    expect(result.current.quick.options).toHaveLength(3);
    expect(result.current.entityConstructor).toBe(SourceBrand);
  });

  it('narrows the suggestions to the settled term', async () => {
    const { result } = renderSource();
    await waitFor(() => expect(result.current.quick.isLoading).toBe(false));

    act(() => result.current.quick.setTerm('glo'));

    await waitFor(() =>
      expect(result.current.quick.options.map(option => option.name)).toEqual([
        'Globex',
      ]),
    );
    expect(result.current.quick.term).toBe('glo');
  });

  it('keeps a standing restriction over the term', async () => {
    const { result } = renderSource({
      baseFiltering: {
        operator: 'and',
        values: [{ property: 'name', operator: 'like', value: 'ini' }],
      },
    });
    await waitFor(() => expect(result.current.quick.isLoading).toBe(false));

    act(() => result.current.quick.setTerm('e'));

    // Both apply: `ini` from the caller, `e` from the user.
    await waitFor(() =>
      expect(result.current.quick.options.map(option => option.name)).toEqual([
        'Initech',
      ]),
    );
  });

  // The dialog's table is the expensive half; nobody who never opened it should
  // pay for a request.
  it('does not load the browse list until the dialog opens', async () => {
    const { result } = renderSource();
    await waitFor(() => expect(result.current.quick.isLoading).toBe(false));

    expect(result.current.browse.isOpen).toBe(false);
    expect(result.current.browse.items).toHaveLength(0);

    act(() => result.current.browse.open());

    await waitFor(() => expect(result.current.browse.items).toHaveLength(3));
    expect(result.current.browse.isOpen).toBe(true);

    act(() => result.current.browse.close());
    expect(result.current.browse.isOpen).toBe(false);
  });

  it('reads a target by the relation’s label property', async () => {
    const { result } = renderSource();

    expect(result.current.labelOf(BRANDS[0]!)).toBe('Acme');
  });

  it('falls back to the id when the label property is empty', async () => {
    const { result } = renderSource();

    expect(result.current.labelOf(brand('b-9', ''))).toBe('b-9');
    expect(result.current.labelOf(new SourceBrand())).toBe('');
  });

  it('takes the label from the instance the caller already holds', async () => {
    const { result } = renderSource({
      selectedId: 'b-1',
      selectedEntity: BRANDS[0]!,
    });

    expect(result.current.selected).toEqual({
      label: 'Acme',
      entity: BRANDS[0]!,
      isLoading: false,
    });
  });

  // The restored-draft case: an id and nothing else, so the name is looked up.
  it('resolves the label of a held key with no instance', async () => {
    const { result } = renderSource({ selectedId: 'b-2' });

    await waitFor(() => expect(result.current.selected.label).toBe('Globex'));
  });

  // The instance, not only the name: a form rebuilding an `embedded` relation
  // from a restored draft has the id and nothing else to inline.
  it('carries the resolved instance out, not just its label', async () => {
    const { result } = renderSource({ selectedId: 'b-2' });

    await waitFor(() =>
      expect(result.current.selected.entity).toEqual(
        BRANDS.find(candidate => candidate.id === 'b-2'),
      ),
    );
  });

  it('has no label to show without a get use-case', async () => {
    const { result } = renderSource({ selectedId: 'b-2', withGetUc: false });

    await waitFor(() => expect(result.current.quick.isLoading).toBe(false));

    expect(result.current.selected).toEqual({
      label: undefined,
      isLoading: false,
    });
  });

  it('resolves nothing when no key is held', async () => {
    const { result } = renderSource();

    await waitFor(() => expect(result.current.quick.isLoading).toBe(false));

    expect(result.current.selected.label).toBeUndefined();
  });

  // The service rejects a filter on a member that is not `filterable`, and the
  // rejection would reach the user as "there are no brands".
  it('refuses to search a member the service would reject', () => {
    expect(() =>
      renderSource({
        descriptor: brandDescriptor({ linkSearchProperty: 'notes' }),
      }),
    ).toThrow(Error);
  });

  it('refuses to search a member that does not exist', () => {
    expect(() =>
      renderSource({
        descriptor: brandDescriptor({ linkSearchProperty: 'nope' }),
      }),
    ).toThrow(Error);
  });

  it('surfaces a failed suggestion request', async () => {
    repository.failNext(new Unavailable({ dependency: 'unreachable' }));
    const { result } = renderSource();

    await waitFor(() => expect(result.current.quick.error).toBeDefined());
  });
});

@entity({ key: 'source-category' })
class SourceCategory implements Entity {
  #id?: EntityId;
  #name?: LocalizedText;

  @accessor({ type: 'id' })
  get id(): EntityId {
    return this.#id;
  }
  set id(value: EntityId) {
    this.#id = value;
  }

  @accessor({ type: 'localized' })
  get name(): LocalizedText | undefined {
    return this.#name;
  }
  set name(value: LocalizedText | undefined) {
    this.#name = value;
  }
}

@entity({ key: 'source-offering' })
class SourceOffering implements Entity {
  #id?: EntityId;
  #category = new EntityLink(SourceCategory);

  @accessor({ type: 'id' })
  get id(): EntityId {
    return this.#id;
  }
  set id(value: EntityId) {
    this.#id = value;
  }

  @accessor({ type: 'link', label: 'Category' })
  get category(): EntityLink<SourceCategory> {
    return this.#category;
  }
}

const category = (id: string, name: LocalizedText): SourceCategory => {
  const instance = new SourceCategory();
  instance.id = id;
  instance.name = name;
  return instance;
};

describe('useEntityLinkSource over a localized member', () => {
  const loads: EntityLoadRequest[] = [];
  let categories: ReturnType<typeof makeInMemoryEntityRepository>;

  beforeEach(() => {
    defineLocales({ locales: ['es', 'en'], defaultLocale: 'es' });
    loads.length = 0;
    categories = makeInMemoryEntityRepository([
      category('c-1', { es: 'Café', en: 'Coffee' }),
      category('c-2', { es: 'Té', en: 'Tea' }),
      category('c-3', { es: 'Azúcar' }),
    ]);
  });
  afterEach(() => resetLocales());

  const renderCategories = (locale: Locale) =>
    renderHook(
      () =>
        useEntityLinkSource<SourceCategory, Ctx>(
          {
            entityConstructor: SourceCategory,
            loadUc: loadUCFactory<SourceCategory>(),
            ctx: Context.make(EntityRepositoryTag, {
              ...categories,
              load: (request: EntityLoadRequest) => {
                loads.push(request);
                return categories.load(request);
              },
            } as never),
            debounceMs: 0,
          },
          {
            descriptor: describeEntityColumns(SourceOffering).find(
              column => column.name === 'category',
            )!,
            locale,
          },
        ),
      { wrapper },
    );

  it.each([
    ['es', 'name.es', 'Café'],
    ['en', 'name.en', 'Coffee'],
  ] as const)(
    'filters and sorts in %s, matching an accented name from a bare term',
    async (locale, property, label) => {
      const { result } = renderCategories(locale);
      await waitFor(() => expect(result.current.quick.isLoading).toBe(false));

      act(() =>
        result.current.quick.setTerm(locale === 'es' ? 'cafe' : 'coff'),
      );

      await waitFor(() =>
        expect(result.current.quick.options.map(option => option.id)).toEqual([
          'c-1',
        ]),
      );
      const last = loads.at(-1)!;
      expect(last.filtering?.[0]).toMatchObject({
        values: [{ property, operator: 'like' }],
      });
      expect(last.sorting).toEqual([{ 0: { property, type: 'asc' } }]);
      expect(result.current.labelOf(result.current.quick.options[0]!)).toBe(
        label,
      );
    },
  );

  it('reads a name the locale lacks in the default one', async () => {
    const { result } = renderCategories('en');
    await waitFor(() => expect(result.current.quick.options).toHaveLength(3));

    const sugar = result.current.quick.options.find(
      option => option.id === 'c-3',
    )!;
    expect(result.current.labelOf(sugar)).toBe('Azúcar');
  });

  it('reads an option by its id when its label member is not declared', async () => {
    const { result } = renderSource({
      descriptor: brandDescriptor({ linkLabelProperty: 'nope' }),
    });
    await waitFor(() => expect(result.current.quick.options).toHaveLength(3));

    expect(result.current.labelOf(result.current.quick.options[0]!)).toBe(
      'b-1',
    );
  });

  it('still refuses a localized member that is not filterable', () => {
    expect(() =>
      renderSource({
        descriptor: brandDescriptor({ linkSearchProperty: 'motto' }),
      }),
    ).toThrow(/the member is not filterable/);
  });
});
