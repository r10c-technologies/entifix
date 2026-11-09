import { EntityRepositoryTag } from '@entifix/business';
import { Unavailable } from '@entifix/core';
import {
  accessor,
  type BulkOutcome,
  type DomainEvent,
  type EntifixFailure,
  type Entity,
  entity,
  type EntityDraft,
  type EntityId,
  type EntityMetadataSource,
  type EntityUseCaseRunner,
  type EntityWriter,
  Failure,
  pending,
  settled,
  type WriteResult,
} from '@entifix/core';
import {
  EntityColumn,
  ToastProvider,
  ToastRegion,
} from '@entifix/react-controls';
import {
  EntifixQueryProvider,
  type FlowStatusRead,
  makeInMemoryPushChannel,
  makeQueryClient,
} from '@entifix/react-integration';
import { makeInMemoryEntityRepository } from '@entifix/testing-unit';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Context, Effect } from 'effect';
import { type ReactElement, useState } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { EntityNavProvider } from '../workspace/entity-nav.js';
import { PendingFlowsProvider } from '../workspace/pending-flows.js';
import { makeEntityCrud } from './make-entity-crud.js';
import { CATALOG_NEW_SLUG } from './slug.js';

/** A refusal the way a domain declares one: a code the catalog translates. */
class AlreadyRetired extends Failure.declined<AlreadyRetired>()(
  'AlreadyRetired',
  'alreadyRetired',
) {}

// The pages read the route through `next/navigation`, which only exists inside
// a running Next app; the slug is the one input a test needs to vary.
const push = vi.fn();
let slug = 'new';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push }),
  useParams: () => ({ slug }),
}));

/**
 * Entities declared here rather than imported from a domain package: the factory
 * is framework code and must not learn any domain, and a local class is the only
 * way to exercise the shapes that matter — a member the create transaction
 * assigns, and a scalar foreign key with no typed link behind it.
 *
 * They borrow the real catalog keys so `useT('entity')` resolves real copy and
 * the assertions can stay in Spanish, the default locale, like every other suite.
 */
@entity({
  domain: 'testing',
  key: 'product-brand',
  labelKey: 'entity:product-brand.label',
  pluralKey: 'entity:product-brand.plural',
})
class Brand implements Entity {
  #id?: EntityId;
  #code?: string;
  #name: string;
  #website?: string;

  constructor(name = '') {
    this.#name = name;
  }

  @accessor({
    type: 'id',
    label: 'ID',
    labelKey: 'entity:product-brand.fields.id',
  })
  get id(): EntityId {
    return this.#id;
  }
  set id(value: EntityId) {
    this.#id = value;
  }

  @accessor({
    type: 'string',
    label: 'Code',
    labelKey: 'entity:product-brand.fields.code',
  })
  get code(): string | undefined {
    return this.#code;
  }
  set code(value: string | undefined) {
    this.#code = value;
  }

  @accessor({
    type: 'string',
    label: 'Name',
    labelKey: 'entity:product-brand.fields.name',
    required: true,
    filterable: true,
  })
  get name(): string {
    return this.#name;
  }
  set name(value: string) {
    this.#name = value;
  }

  @accessor({
    type: 'string',
    label: 'Website',
    labelKey: 'entity:product-brand.fields.website',
  })
  get website(): string | undefined {
    return this.#website;
  }
  set website(value: string | undefined) {
    this.#website = value;
  }
}

@entity({
  domain: 'testing',
  key: 'product-specification',
  labelKey: 'entity:product-specification.label',
  pluralKey: 'entity:product-specification.plural',
})
class Product implements Entity {
  #id?: EntityId;
  #name: string;
  #brandId?: string;

  constructor(name = '') {
    this.#name = name;
  }

  @accessor({
    type: 'id',
    label: 'ID',
    labelKey: 'entity:product-specification.fields.id',
  })
  get id(): EntityId {
    return this.#id;
  }
  set id(value: EntityId) {
    this.#id = value;
  }

  @accessor({
    type: 'string',
    label: 'Name',
    labelKey: 'entity:product-specification.fields.name',
    required: true,
    filterable: true,
  })
  get name(): string {
    return this.#name;
  }
  set name(value: string) {
    this.#name = value;
  }

  // A bare id, not a `link`: its target is another slice's store.
  @accessor({
    type: 'string',
    label: 'Brand',
    // The catalog key is `brand`, not `brandId`: the field holds an id but the
    // label names the thing.
    labelKey: 'entity:product-specification.fields.brand',
  })
  get brandId(): string | undefined {
    return this.#brandId;
  }
  set brandId(value: string | undefined) {
    this.#brandId = value;
  }
}

interface TestAdapters {
  brandRest: Context.Context<EntityRepositoryTag>;
  productRest: Context.Context<EntityRepositoryTag>;
  brandMetadata: EntityMetadataSource;
  brandVerbs: EntityUseCaseRunner;
  brandWrite: EntityWriter;
}

/**
 * A draft store double. `save`/`clear` are stable identities because the port
 * requires it: `useEntityForm` autosaves from an effect keyed on `save`.
 */
function draftStore(draft?: EntityDraft) {
  return { draft, save: vi.fn(), clear: vi.fn() };
}

let repositories: {
  brand: ReturnType<typeof makeInMemoryEntityRepository>;
  product: ReturnType<typeof makeInMemoryEntityRepository>;
};

// The runner adapter forwards to two mocks, so the specs assert the key and
// the target each verb was run with.
const brandVerbs: EntityUseCaseRunner = {
  run: (useCase, id) =>
    Effect.tryPromise({
      try: () => runVerb(useCase.key, id) as Promise<WriteResult<unknown>>,
      catch: failure => failure as EntifixFailure,
    }),
  bulk: (useCase, selection) =>
    Effect.tryPromise({
      try: () =>
        runBulk(useCase.key, selection) as Promise<readonly BulkOutcome[]>,
      catch: failure => failure as EntifixFailure,
    }),
};

// The writer forwards to two mocks, answering whichever mode a spec sets.
const writeSave = vi.fn<(entity: Entity) => Promise<WriteResult<Entity>>>();
const writeDelete =
  vi.fn<(target: EntityId | Entity) => Promise<WriteResult<void>>>();
const brandWrite = {
  save: entity => Effect.promise(() => writeSave(entity)),
  delete: target => Effect.promise(() => writeDelete(target)),
} as EntityWriter;

const useAdapters = (): TestAdapters => ({
  brandRest: Context.make(EntityRepositoryTag, repositories.brand),
  productRest: Context.make(EntityRepositoryTag, repositories.product),
  brandMetadata: { fetchMetadata: () => fetchMetadata() },
  brandVerbs,
  brandWrite,
});

const brandCrud = makeEntityCrud<Brand, TestAdapters>(Brand, {
  useAdapters,
  basePath: '/catalog/product-brand',
  catalogKey: 'product-brand',
  repository: 'brandRest',
  hiddenFields: ['id', 'code'],
  columns: (
    <EntityColumn<Brand>
      field="website"
      render={brand => <span>{brand.website ?? '—'}</span>}
    />
  ),
});

// No `labelProperty`/`searchProperty`, so the picker falls back to `'name'`.
const productCrud = makeEntityCrud<Product, TestAdapters>(Product, {
  useAdapters,
  basePath: '/catalog/product',
  catalogKey: 'product-specification',
  repository: 'productRest',
  hiddenFields: ['id'],
  links: [
    { field: 'brandId', entityConstructor: Brand, repository: 'brandRest' },
  ],
});

/**
 * The list's first page size, raised past the in-memory default of ten and
 * then lowered below the seeded count, so a page that ignored the option would
 * show every row.
 */
const pagedBrandCrud = makeEntityCrud<Brand, TestAdapters>(Brand, {
  useAdapters,
  basePath: '/catalog/brand',
  catalogKey: 'product-brand',
  repository: 'brandRest',
  hiddenFields: ['id', 'code'],
  pageSize: 2,
});

/**
 * A picker whose selectable set depends on the record being edited. The rule
 * here is arbitrary — each product refuses the brands this table names for it —
 * because what is under test is that the record reaches the rule, not the rule.
 * A hook, so it reads React state as a real rule loading a subtree would.
 */
const refusedBrands: Record<string, string[]> = { 'p-1': ['b-1'] };
const brandFilterFor = vi.fn((product: Product | undefined) => {
  const refused =
    product === undefined ? undefined : refusedBrands[String(product.id)];
  return refused === undefined
    ? undefined
    : {
        operator: 'and' as const,
        values: [
          {
            property: 'id' as const,
            operator: 'nin' as const,
            values: refused,
          },
        ],
      };
});
const useBrandFilter = (product: Product | undefined) => {
  const [rule] = useState(() => brandFilterFor);
  return rule(product);
};

const filteredProductCrud = makeEntityCrud<Product, TestAdapters>(Product, {
  useAdapters,
  basePath: '/catalog/product',
  catalogKey: 'product-specification',
  repository: 'productRest',
  hiddenFields: ['id'],
  links: [
    {
      field: 'brandId',
      entityConstructor: Brand,
      repository: 'brandRest',
      useBaseFiltering: useBrandFilter,
    },
  ],
});

/**
 * The same entity again, opted into the affordances half: a metadata source and
 * a bulk runner. Separate from `brandCrud` on purpose — the un-opted factory
 * has to keep rendering exactly as it did before either option existed, and one
 * shared instance could not show both.
 */
const runBulk = vi.fn();
const fetchMetadata = vi.fn();

const bulkBrandCrud = makeEntityCrud<Brand, TestAdapters>(Brand, {
  useAdapters,
  basePath: '/catalog/brand',
  catalogKey: 'product-brand',
  repository: 'brandRest',
  hiddenFields: ['id', 'code'],
  metadataSource: { fetchMetadata: () => fetchMetadata() },
  useCases: 'brandVerbs',
});

/**
 * The entity-bound half of the same opt-in. Separate again, because a crud
 * carrying a use-case runner must be shown to render *and run* the verb while
 * `brandCrud`, which carries neither option, goes on rendering none.
 */
const runVerb = vi.fn();

const verbBrandCrud = makeEntityCrud<Brand, TestAdapters>(Brand, {
  useAdapters,
  basePath: '/catalog/brand',
  catalogKey: 'product-brand',
  repository: 'brandRest',
  hiddenFields: ['id', 'code'],
  metadataSource: { fetchMetadata: () => fetchMetadata() },
  useCases: 'brandVerbs',
});

/**
 * The same opt-in as `verbBrandCrud`, with the source named by adapter key
 * rather than built here — the shape a module that must not import a transport
 * uses.
 */
const keyedBrandCrud = makeEntityCrud<Brand, TestAdapters>(Brand, {
  useAdapters,
  basePath: '/catalog/brand',
  catalogKey: 'product-brand',
  repository: 'brandRest',
  hiddenFields: ['id', 'code'],
  metadata: 'brandMetadata',
});

const makeBrand = (id: string, name: string, code?: string) => {
  const brand = new Brand(name);
  brand.id = id;
  brand.code = code;
  return brand;
};

const renderPage = (page: ReactElement) =>
  render(<EntifixQueryProvider>{page}</EntifixQueryProvider>);

beforeEach(() => {
  push.mockClear();
  runVerb.mockReset();
  writeSave.mockReset();
  writeDelete.mockReset();
  slug = 'new';
  repositories = {
    brand: makeInMemoryEntityRepository([
      makeBrand('b-1', 'Acme', 'brand-001'),
    ] as Entity[]),
    product: makeInMemoryEntityRepository([] as Entity[]),
  };
});

/**
 * Clicks a record page's action, and answers its confirmation when it asks
 * one — Delete does, as every destructive verb must (ADR 0026).
 */
async function press(user: ReturnType<typeof userEvent.setup>, name: string) {
  await user.click(screen.getByRole('button', { name }));
  const dialog = screen.queryByRole('alertdialog');
  if (dialog !== null)
    await user.click(within(dialog).getByRole('button', { name }));
}

describe('makeEntityCrud, at factory time', () => {
  // The catalog key and `@entity({ key })` are the same string by convention, so
  // a drifted one is invisible: the form renders, titled after another entity.
  it('rejects a catalog key that is not the entity’s own', () => {
    expect(() =>
      makeEntityCrud<Brand, TestAdapters>(Brand, {
        useAdapters,
        basePath: '/catalog/product-brand',
        catalogKey: 'product-category',
        repository: 'brandRest',
      }),
    ).toThrow(Error);
  });

  // Two answers to where the served document comes from, and nothing to say
  // which one the screens would use.
  it('rejects a metadata source given both directly and by adapter key', () => {
    expect(() =>
      makeEntityCrud<Brand, TestAdapters>(Brand, {
        useAdapters,
        basePath: '/catalog/product-brand',
        catalogKey: 'product-brand',
        repository: 'brandRest',
        metadataSource: { fetchMetadata: () => fetchMetadata() },
        metadata: 'brandMetadata',
      }),
    ).toThrow(/both metadataSource and metadata/);
  });

  // `MetaEntityOptions` makes both keys optional, and a screen generated without
  // them titles its tabs `undefined` — at render, on a surface nobody generated
  // deliberately, rather than here where the entity was handed over.
  it('rejects an entity that declares no label or plural key', () => {
    @entity({ domain: 'testing', key: 'product-category' })
    class Unnamed implements Entity {
      #id?: EntityId;

      @accessor({ type: 'id', label: 'ID' })
      get id(): EntityId | undefined {
        return this.#id;
      }
      set id(value: EntityId | undefined) {
        this.#id = value;
      }
    }

    expect(() =>
      makeEntityCrud<Unnamed, TestAdapters>(Unnamed, {
        useAdapters,
        basePath: '/catalog/product-category',
        catalogKey: 'product-category',
        repository: 'brandRest',
      }),
    ).toThrow(/labelKey and pluralKey/);
  });

  // A picker aimed at a member that does not exist renders identically to a
  // read-only field — the same silent failure `assertLinkSourcesAreEditable`
  // exists to catch one layer down.
  it('rejects a link naming a member the entity does not declare', () => {
    expect(() =>
      makeEntityCrud<Product, TestAdapters>(Product, {
        useAdapters,
        basePath: '/catalog/product',
        catalogKey: 'product-specification',
        repository: 'productRest',
        links: [
          {
            field: 'vendorId',
            entityConstructor: Brand,
            repository: 'brandRest',
          },
        ],
      }),
    ).toThrow(/no member "vendorId"/);
  });

  // The allowlist a service applies: a member outside it — here one the entity
  // never declared, which the type would refuse, so it arrives cast as a
  // string built at runtime would — throws where the screen is generated.
  it('rejects an initial filtering on a member outside the allowlist', () => {
    expect(() =>
      makeEntityCrud<Brand, TestAdapters>(Brand, {
        useAdapters,
        basePath: '/catalog/brand',
        catalogKey: 'product-brand',
        repository: 'brandRest',
        initialFiltering: {
          operator: 'and',
          values: [
            { property: 'vendor' as 'name', operator: 'eq', value: 'x' },
          ],
        },
      }),
    ).toThrow(/vendor/);
  });

  it('accepts an emptied initial filtering, which filters nothing', () => {
    expect(() =>
      makeEntityCrud<Brand, TestAdapters>(Brand, {
        useAdapters,
        basePath: '/catalog/brand',
        catalogKey: 'product-brand',
        repository: 'brandRest',
        initialFiltering: { operator: 'and', values: [] },
      }),
    ).not.toThrow();
  });

  it('carries the entity’s identity for a registry to derive from', () => {
    expect(brandCrud.entityKey).toBe('product-brand');
    expect(brandCrud.basePath).toBe('/catalog/product-brand');
    expect(brandCrud.entityConstructor).toBe(Brand);
  });

  it('names the entity from its own catalog subtree, singular and plural', () => {
    // A list tab is titled with the plural and a record tab with the label, so
    // both are computed here rather than restated at the registry — which is
    // what let three const maps disagree about what a product is called.
    expect(brandCrud.entityLabelKey).toBe('entity:product-brand.label');
    expect(brandCrud.entityPluralKey).toBe('entity:product-brand.plural');
  });
});

describe('the generated list page', () => {
  it('lists records from the adapters it was given', async () => {
    renderPage(<brandCrud.ListPage />);

    await waitFor(() =>
      expect(screen.getAllByText('Acme').length).toBeGreaterThan(0),
    );
  });

  // The `<EntityColumn>` slot is still the escape hatch for presentation the
  // metadata cannot express, so the factory has to forward it untouched.
  it('forwards the column overrides it was handed', async () => {
    renderPage(<brandCrud.ListPage />);

    await waitFor(() =>
      expect(screen.getAllByText('—').length).toBeGreaterThan(0),
    );
  });
});

/**
 * The adopt half: a generated catalog only gains the served-affordance
 * surfaces when it is handed the two options. Before they existed every
 * generated page ran without them, and omitting them still does.
 */
describe('the generated list page, given a page size', () => {
  it('asks for that many rows on its first load', async () => {
    repositories.brand.seed([
      makeBrand('b-1', 'Acme'),
      makeBrand('b-2', 'Beta'),
      makeBrand('b-3', 'Gamma'),
    ] as Entity[]);

    renderPage(<pagedBrandCrud.ListPage />);

    await waitFor(() =>
      expect(screen.getAllByText('Beta').length).toBeGreaterThan(0),
    );
    expect(screen.queryByText('Gamma')).not.toBeInTheDocument();
  });
});

/** A worklist: the list opens on the rows someone has to act on. */
const worklistBrandCrud = makeEntityCrud<Brand, TestAdapters>(Brand, {
  useAdapters,
  basePath: '/catalog/brand',
  catalogKey: 'product-brand',
  repository: 'brandRest',
  hiddenFields: ['id', 'code'],
  initialFiltering: {
    operator: 'and',
    values: [{ property: 'name', operator: 'eq', value: 'Beta' }],
  },
});

describe('the generated list page, given an initial filtering', () => {
  it('opens on the rows the filtering keeps', async () => {
    repositories.brand.seed([
      makeBrand('b-1', 'Acme'),
      makeBrand('b-2', 'Beta'),
      makeBrand('b-3', 'Gamma'),
    ] as Entity[]);

    renderPage(<worklistBrandCrud.ListPage />);

    await waitFor(() =>
      expect(screen.getAllByText('Beta').length).toBeGreaterThan(0),
    );
    expect(screen.queryByText('Acme')).not.toBeInTheDocument();
    expect(screen.queryByText('Gamma')).not.toBeInTheDocument();
  });
});

describe('the generated list page, opted into affordances', () => {
  const RETIRE = {
    key: 'retire',
    binding: 'collection' as const,
    placement: 'context-dependent' as const,
    labelKey: 'entity:product-brand.useCases.retire',
  };

  beforeEach(() => {
    runBulk.mockReset().mockResolvedValue([{ id: 'b-1', ok: true }]);
    fetchMetadata
      .mockReset()
      .mockResolvedValue({ actions: ['read', 'write'], useCases: [RETIRE] });
  });

  /**
   * The row half: the same verb the form header runs, reached from a
   * row's overflow menu. `EntityTable` hands back the whole record and
   * the runner takes an id, so the list adapts between them.
   */
  describe('a row verb on the list', () => {
    const ARCHIVE = {
      key: 'archive',
      binding: 'entity' as const,
      placement: 'context-dependent' as const,
      labelKey: 'entity:product-brand.useCases.archive',
    };

    it('runs a served row verb and re-reads the rows', async () => {
      const user = userEvent.setup();
      runVerb.mockResolvedValue(settled(undefined));
      fetchMetadata
        .mockReset()
        .mockResolvedValue({ actions: ['read'], useCases: [ARCHIVE] });

      renderPage(<verbBrandCrud.ListPage />);

      await waitFor(() =>
        expect(screen.getAllByText('Acme').length).toBeGreaterThan(0),
      );

      await user.click(
        screen.getAllByRole('button', { name: /^Acciones para / })[0]!,
      );
      await user.click(
        screen.getByRole('menuitem', {
          name: 'product-brand.useCases.archive',
        }),
      );

      await waitFor(() =>
        expect(runVerb).toHaveBeenCalledWith('archive', 'b-1'),
      );
    });

    it('surfaces a failed row verb where a failed read would appear', async () => {
      // The list has no error slot of its own, so it borrows the table's —
      // otherwise a verb that refused would look exactly like one that worked.
      const user = userEvent.setup();
      runVerb.mockRejectedValue(new Error('offeringHasNoPrice'));
      fetchMetadata
        .mockReset()
        .mockResolvedValue({ actions: ['read'], useCases: [ARCHIVE] });

      renderPage(<verbBrandCrud.ListPage />);

      await waitFor(() =>
        expect(screen.getAllByText('Acme').length).toBeGreaterThan(0),
      );

      await user.click(
        screen.getAllByRole('button', { name: /^Acciones para / })[0]!,
      );
      await user.click(
        screen.getByRole('menuitem', {
          name: 'product-brand.useCases.archive',
        }),
      );

      await waitFor(() =>
        expect(screen.getByRole('alert')).toBeInTheDocument(),
      );
    });

    it('does nothing for a row that has no id yet', async () => {
      // An optimistic row is on screen before the service has written it. The
      // verb needs an id to address a route with, so there is nothing to run —
      // and running it against `undefined` would post to `/…/undefined`.
      const user = userEvent.setup();
      repositories = {
        ...repositories,
        brand: makeInMemoryEntityRepository([new Brand('Pending')] as Entity[]),
      };
      fetchMetadata
        .mockReset()
        .mockResolvedValue({ actions: ['read'], useCases: [ARCHIVE] });

      renderPage(<verbBrandCrud.ListPage />);

      await waitFor(() =>
        expect(screen.getAllByText('Pending').length).toBeGreaterThan(0),
      );

      await user.click(
        screen.getAllByRole('button', { name: /^Acciones para / })[0]!,
      );
      await user.click(
        screen.getByRole('menuitem', {
          name: 'product-brand.useCases.archive',
        }),
      );

      expect(runVerb).not.toHaveBeenCalled();
    });

    it('renders no row menu when the crud carries no runner', async () => {
      fetchMetadata
        .mockReset()
        .mockResolvedValue({ actions: ['read'], useCases: [ARCHIVE] });

      renderPage(<brandCrud.ListPage />);

      await waitFor(() =>
        expect(screen.getAllByText('Acme').length).toBeGreaterThan(0),
      );
      expect(
        screen.queryAllByRole('button', { name: /^Acciones para / }),
      ).toHaveLength(0);
    });
  });

  it('renders no selection column without a bulk runner', async () => {
    renderPage(<brandCrud.ListPage />);

    await waitFor(() =>
      expect(screen.getAllByText('Acme').length).toBeGreaterThan(0),
    );
    expect(
      within(screen.getByRole('table')).queryAllByRole('checkbox'),
    ).toHaveLength(0);
  });

  it('renders the selection column once a runner is supplied', async () => {
    renderPage(<bulkBrandCrud.ListPage />);

    await waitFor(() =>
      expect(
        within(screen.getByRole('table')).getAllByRole('checkbox').length,
      ).toBeGreaterThan(0),
    );
  });

  /**
   * Measured live against an `admin`, who holds `catalog-reference:*:read` and
   * no `retire`: the service filters the verb out of the document, but the
   * selection column still rendered — offering a set no action could be taken
   * on. A checkbox that leads nowhere reads as a permission the user does not
   * have, which is worse than no checkbox.
   */
  it('renders no selection column when the caller may run no collection verb', async () => {
    fetchMetadata.mockResolvedValue({ actions: ['read'], useCases: [] });
    renderPage(<bulkBrandCrud.ListPage />);

    await waitFor(() =>
      expect(screen.getAllByText('Acme').length).toBeGreaterThan(0),
    );
    expect(
      within(screen.getByRole('table')).queryAllByRole('checkbox'),
    ).toHaveLength(0);
  });

  /**
   * The whole adopt step in one assertion: a served verb reaches a generated
   * page, runs over the ticked rows, and the listing re-reads what it changed.
   */
  it('runs a served collection verb over the selection and re-reads the rows', async () => {
    const user = userEvent.setup();
    renderPage(<bulkBrandCrud.ListPage />);

    await waitFor(() =>
      expect(screen.getAllByText('Acme').length).toBeGreaterThan(0),
    );

    // Named after the first column that is not the identifier — here the
    // brand's `code`, which is what an operator reads the row as. `hiddenFields`
    // hides members from the *form*, not from the listing.
    await user.click(
      within(screen.getByRole('table')).getByRole('checkbox', {
        name: 'Seleccionar brand-001',
      }),
    );
    // The served document arrives asynchronously — which is the accepted cost
    // of serving affordances: rendering an action is a fetch where rendering a field
    // is not. So the verb appears a tick after the selection does.
    // "Retirar", not the key: this verb's copy is in the real catalog, so the
    // runtime `labelKey` resolves — which is the half a host's catalog check
    // exists to keep true, since the type system cannot see a `translateKey`
    // argument.
    await user.click(await screen.findByRole('button', { name: 'Retirar' }));

    await waitFor(() => expect(runBulk).toHaveBeenCalled());
    expect(runBulk.mock.calls[0]?.[0]).toBe('retire');
    // And the result is reported per row rather than as one notice.
    await waitFor(() =>
      expect(screen.getByTestId('bulk-result')).toBeInTheDocument(),
    );
  });

  it('reports a bulk run whose request failed as every ticked row failing', async () => {
    const user = userEvent.setup();
    runBulk.mockReset().mockRejectedValue(new Error('la red falló'));
    renderPage(<bulkBrandCrud.ListPage />);

    await waitFor(() =>
      expect(screen.getAllByText('Acme').length).toBeGreaterThan(0),
    );
    await user.click(
      within(screen.getByRole('table')).getByRole('checkbox', {
        name: 'Seleccionar brand-001',
      }),
    );
    await user.click(await screen.findByRole('button', { name: 'Retirar' }));

    await waitFor(() =>
      expect(screen.getByTestId('bulk-result')).toHaveTextContent(
        '1 registro falló',
      ),
    );
  });
});

describe('the generated form', () => {
  it('titles a create and an edit differently', async () => {
    renderPage(<brandCrud.SingleViewPage />);
    await waitFor(() => expect(screen.getByText('Nueva marca')).toBeVisible());

    slug = 'b-1';
    renderPage(<brandCrud.SingleViewPage />);
    await waitFor(() => expect(screen.getByText('Editar marca')).toBeVisible());
  });

  /**
   * The i18n seam, end to end.
   *
   * ⚠️ **This shell resolves the `controls` copy and the integration package
   * renders it.** The two are both T3 with no declared edge between them, so `useEntityForm` cannot
   * import the catalog that owns these sentences — it takes them as an option,
   * and this is the only place the wiring is proven. Before the split the hook
   * reached into react-i18next itself, which is what made taking the hooks mean
   * taking i18next and a Spanish catalog.
   */
  it('renders a validation failure in the catalog’s own words', async () => {
    renderPage(<brandCrud.SingleViewPage />);
    await waitFor(() => expect(screen.getByText('Nueva marca')).toBeVisible());

    fireEvent.click(screen.getByRole('button', { name: /guardar/i }));

    // The field by its catalog word — `Nombre`, from `labelKey` — not the
    // accessor's English `label` inside a Spanish sentence (#22).
    await waitFor(() =>
      expect(screen.getByLabelText('Nombre')).toHaveAccessibleDescription(
        'Nombre es obligatorio',
      ),
    );
    // No message on the form is a catalog key the copy never reached.
    for (const message of screen.getAllByText(/obligatori/))
      expect(message.textContent).not.toMatch(/^[\w.]+:/);
  });

  // `entity` is undefined until the record lands, so testing it alone titled a
  // loading edit form "New" and then relabelled it.
  it('does not title a loading edit form as a create', async () => {
    slug = 'b-1';
    repositories.brand.failNext(new Unavailable({ dependency: 'unreachable' }));

    renderPage(<brandCrud.SingleViewPage />);

    expect(screen.queryByText(/^Nueva/)).toBeNull();
  });

  /**
   * ⚠️ **Measured live on the stock surface, which is what this exists for.**
   * `stock-item` answers `["read"]` — no role holds `stock-item:write` and the
   * service serves no save route — so Save was correctly withheld while
   * `onHand` and `reserved` still rendered as enabled number inputs. A vendor
   * could type into a field only a ledger moves, and nothing would
   * happen and nothing would say why.
   *
   * The record's values stay visible; what goes away is the ability to change
   * them, decided by the same document that decides Save.
   */
  it('renders a record read-only when the caller may not write it', async () => {
    slug = 'b-1';
    fetchMetadata.mockResolvedValue({ actions: ['read'], useCases: [] });

    renderPage(<verbBrandCrud.SingleViewPage />);

    await waitFor(() => expect(screen.getByText('Acme')).toBeInTheDocument());
    expect(screen.queryByLabelText(/nombre/i)).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /guardar/i }),
    ).not.toBeInTheDocument();
    // And no way back into the inputs: the built-in Ver/Editar toggle is
    // suppressed whenever the mode is supplied, so a refused write cannot be
    // reached around.
    expect(
      screen.queryByRole('button', { name: /editar/i }),
    ).not.toBeInTheDocument();
  });

  /**
   * A create has no record to read, so the rule above must not reach it — a
   * `read` mode on a new entity is an empty form with no way to fill it.
   */
  it('still edits a create, whatever the descriptor says about writing', async () => {
    // `new` is the create slug; the page resolves it to a null id, so there is
    // no record — and no record is the exemption.
    slug = CATALOG_NEW_SLUG;
    fetchMetadata.mockResolvedValue({ actions: ['read'], useCases: [] });

    renderPage(<verbBrandCrud.SingleViewPage />);

    expect(await screen.findByLabelText(/nombre/i)).toBeInTheDocument();
  });

  /**
   * ⚠️ The defect this option exists for, measured live on `ProductOffering`:
   * `EntityForm` has rendered these buttons for a long time and `EntityCrudForm`
   * has accepted an `onUseCase` for as long, but `makeEntityCrud` never passed
   * one — so a declared, granted, `$metadata`-served verb appeared on the form
   * and did nothing at all when clicked.
   */
  it('runs an entity-bound verb on the record it is showing', async () => {
    slug = 'b-1';
    runVerb.mockClear();
    fetchMetadata.mockResolvedValue({
      actions: ['read', 'write'],
      useCases: [
        {
          key: 'publish',
          binding: 'entity',
          placement: 'context-independent',
          labelKey: 'entity:product-brand.useCases.retire',
        },
      ],
    });

    // Resolving means the record changed, so the verb rewrites it in the store
    // and the assertion is that the *form* caught up. Asserting only that the
    // runner was called would pass against a page that never reloads and goes
    // on showing the old state — which reads as "the button did nothing".
    runVerb.mockImplementation(async () => {
      await Effect.runPromise(
        repositories.brand.save(
          makeBrand('b-1', 'Acme Publicada', 'brand-001'),
        ),
      );
      return settled(undefined);
    });

    renderPage(<verbBrandCrud.SingleViewPage />);

    const button = await screen.findByRole('button', { name: /retirar/i });
    fireEvent.click(button);

    await waitFor(() => expect(runVerb).toHaveBeenCalledWith('publish', 'b-1'));
    await waitFor(() =>
      expect(screen.getByLabelText(/nombre/i)).toHaveValue('Acme Publicada'),
    );
  });

  /**
   * ⚠️ Measured live: an offering refusing `unpublish` from `draft` answered
   * `409` with a coded body, the record correctly did not move — and the
   * operator saw nothing at all, because `onUseCase` returns `void` and the
   * rejection went to the console. A verb that fails silently is
   * indistinguishable from a button that is not wired.
   */
  it('shows a refused verb’s coded message instead of dropping it', async () => {
    slug = 'b-1';
    runVerb.mockClear();
    runVerb.mockRejectedValueOnce(new AlreadyRetired());
    fetchMetadata.mockResolvedValue({
      actions: ['read', 'write'],
      useCases: [
        {
          key: 'publish',
          binding: 'entity',
          placement: 'context-independent',
          labelKey: 'entity:product-brand.useCases.retire',
        },
      ],
    });

    renderPage(<verbBrandCrud.SingleViewPage />);

    fireEvent.click(await screen.findByRole('button', { name: /retirar/i }));

    // The `errors` catalog's Spanish copy for that code, resolved through
    // `useErrorMessage` — not the thrown message, which nobody wrote for a user.
    await waitFor(() =>
      expect(screen.getByText(/ya estaba retirado/i)).toBeVisible(),
    );
  });

  /**
   * A rejection that is not a typed failure is a bug that reached the screen:
   * it is shown as `Internal`, never with its own text, which nobody wrote for
   * a user.
   */
  it.each([
    ['a plain Error', new Error('la red falló'), 'Algo falló de nuestro lado.'],
    ['a thrown value with no message', 42, 'Algo falló de nuestro lado.'],
  ])('renders %s', async (_name, thrown, expected) => {
    slug = 'b-1';
    runVerb.mockRejectedValueOnce(thrown);
    fetchMetadata.mockResolvedValue({
      actions: ['read', 'write'],
      useCases: [
        {
          key: 'publish',
          binding: 'entity',
          placement: 'context-independent',
          labelKey: 'entity:product-brand.useCases.retire',
        },
      ],
    });

    renderPage(<verbBrandCrud.SingleViewPage />);

    fireEvent.click(await screen.findByRole('button', { name: /retirar/i }));

    await waitFor(() => expect(screen.getByText(expected)).toBeVisible());
  });

  /**
   * ⚠️ This assertion was **vacuous** when first written: it awaited the create
   * title and then queried, while `fetchMetadata` was still in flight — so it
   * passed against a form that did render the verbs, which is exactly what the
   * live pass then found. Awaiting a metadata-dependent element first is what
   * makes the negative claim mean anything.
   */
  it('offers no verb on a create, where there is no record to act on', async () => {
    // `new` is the create slug; the page resolves it to a null id.
    slug = CATALOG_NEW_SLUG;
    runVerb.mockClear();
    fetchMetadata.mockResolvedValue({
      actions: ['read', 'write'],
      useCases: [
        {
          key: 'publish',
          binding: 'entity',
          placement: 'context-independent',
          labelKey: 'entity:product-brand.useCases.retire',
        },
      ],
    });

    renderPage(<verbBrandCrud.SingleViewPage />);

    // Save is gated on the same metadata document the verbs come from, so its
    // arrival proves the fetch resolved and the absence below is a decision
    // rather than a race.
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /guardar/i })).toBeVisible(),
    );
    expect(screen.queryByRole('button', { name: /retirar/i })).toBeNull();
  });

  it('hides every member it was told to hide, and shows the rest', async () => {
    slug = 'b-1';

    renderPage(<brandCrud.SingleViewPage />);

    await waitFor(() =>
      expect(screen.getByLabelText(/nombre/i)).toHaveValue('Acme'),
    );
    expect(screen.queryByLabelText(/código/i)).toBeNull();
  });

  // A hidden member is dropped from the rendered fields, not from the draft:
  // `code` is assigned by the create transaction and must survive an update
  // that never showed it.
  it('carries a hidden member back out of the draft on save', async () => {
    slug = 'b-1';
    const user = userEvent.setup();
    renderPage(<brandCrud.SingleViewPage />);
    await waitFor(() =>
      expect(screen.getByLabelText(/nombre/i)).toHaveValue('Acme'),
    );

    await user.clear(screen.getByLabelText(/nombre/i));
    await user.type(screen.getByLabelText(/nombre/i), 'Globex');
    await user.click(screen.getByRole('button', { name: 'Guardar' }));

    await waitFor(() => expect(push).toHaveBeenCalledTimes(1));
    const saved = repositories.brand.items[0] as Brand;
    expect(saved.name).toBe('Globex');
    expect(saved.code).toBe('brand-001');
    expect(saved.id).toBe('b-1');
  });

  // The inverse of `seedFieldValue`: a field the user never touched submits as
  // absent, not as an empty string that would persist as a real value.
  it('submits an untouched optional as undefined, not an empty string', async () => {
    const user = userEvent.setup();
    renderPage(<brandCrud.SingleViewPage />);
    await waitFor(() => expect(screen.getByLabelText(/nombre/i)).toBeVisible());

    await user.type(screen.getByLabelText(/nombre/i), 'Initech');
    await user.click(screen.getByRole('button', { name: 'Guardar' }));

    await waitFor(() => expect(push).toHaveBeenCalledTimes(1));
    const saved = repositories.brand.items.at(-1) as Brand;
    expect(saved.name).toBe('Initech');
    expect(saved.website).toBeUndefined();
  });

  it('offers no delete on the create slug', async () => {
    renderPage(<brandCrud.SingleViewPage />);

    await waitFor(() => expect(screen.getByLabelText(/nombre/i)).toBeVisible());
    expect(
      screen.queryByRole('button', { name: 'Eliminar' }),
    ).not.toBeInTheDocument();
  });

  // Both write paths fall back to the list route when no host claims them.
  it.each([
    ['a save', 'Guardar'],
    ['a delete', 'Eliminar'],
  ])('returns to the listing after %s', async (_label, button) => {
    slug = 'b-1';
    const user = userEvent.setup();
    renderPage(<brandCrud.SingleViewPage />);
    await waitFor(() =>
      expect(screen.getByLabelText(/nombre/i)).toHaveValue('Acme'),
    );

    await press(user, button);

    await waitFor(() => expect(push).toHaveBeenCalledTimes(1));
    // Locale-prefixed: an unprefixed href still resolves, but the middleware
    // bounces it, so the visitor pays a round trip per navigation.
    expect(push).toHaveBeenCalledWith('/es/catalog/product-brand');
  });

  // The list the page returns to is navigated to client-side now (#20), so its
  // cached page would otherwise show the record as it was before the write.
  it.each([
    ['a save', 'Guardar'],
    ['a delete', 'Eliminar'],
  ])('marks the cached list stale after %s', async (_label, button) => {
    slug = 'b-1';
    const user = userEvent.setup();
    const client = makeQueryClient();
    const invalidate = vi.spyOn(client, 'invalidateQueries');
    render(
      <EntifixQueryProvider client={client}>
        <brandCrud.SingleViewPage />
      </EntifixQueryProvider>,
    );
    await waitFor(() =>
      expect(screen.getByLabelText(/nombre/i)).toHaveValue('Acme'),
    );

    await press(user, button);

    await waitFor(() => expect(push).toHaveBeenCalledTimes(1));
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: expect.arrayContaining([expect.anything()]),
    });
  });

  // #20: inside a workspace tab the list is a tab, and a URL push would leave
  // the workspace.
  it.each([
    ['a save', 'Guardar'],
    ['a delete', 'Eliminar'],
  ])(
    'returns to the list tab after %s when a tab host is mounted',
    async (_label, button) => {
      slug = 'b-1';
      const user = userEvent.setup();
      const nav = { toList: vi.fn(), toEntity: vi.fn() };
      renderPage(
        <EntityNavProvider value={nav}>
          <brandCrud.SingleViewPage />
        </EntityNavProvider>,
      );
      await waitFor(() =>
        expect(screen.getByLabelText(/nombre/i)).toHaveValue('Acme'),
      );

      await press(user, button);

      await waitFor(() =>
        expect(nav.toList).toHaveBeenCalledWith('product-brand'),
      );
      expect(push).not.toHaveBeenCalled();
    },
  );

  it.each([
    ['saving', 'Guardar'],
    ['deleting', 'Eliminar'],
  ])('stays on the form when %s fails', async (_label, button) => {
    slug = 'b-1';
    const user = userEvent.setup();
    renderPage(<brandCrud.SingleViewPage />);
    await waitFor(() =>
      expect(screen.getByLabelText(/nombre/i)).toHaveValue('Acme'),
    );
    repositories.brand.failNext(new Unavailable({ dependency: 'unreachable' }));

    await press(user, button);

    await waitFor(() =>
      expect(screen.getByTestId('region-state-error')).toBeInTheDocument(),
    );
    expect(push).not.toHaveBeenCalled();
  });

  // The workspace tab host overrides both, so a save inside a tab stays in the
  // workspace instead of navigating the whole app to the list route.
  it('calls the host’s callbacks instead of navigating, when given them', async () => {
    slug = 'b-1';
    const onSaved = vi.fn();
    const onDeleted = vi.fn();
    const user = userEvent.setup();
    renderPage(
      <brandCrud.SingleViewPage
        slug="b-1"
        onSaved={onSaved}
        onDeleted={onDeleted}
      />,
    );
    await waitFor(() =>
      expect(screen.getByLabelText(/nombre/i)).toHaveValue('Acme'),
    );

    await user.click(screen.getByRole('button', { name: 'Guardar' }));
    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));

    await press(user, 'Eliminar');
    await waitFor(() => expect(onDeleted).toHaveBeenCalledTimes(1));
    expect(push).not.toHaveBeenCalled();
  });

  it('seeds from a persisted draft and reports every edit', async () => {
    const store = draftStore({ name: 'Hooli' });
    const user = userEvent.setup();

    renderPage(<brandCrud.SingleViewPage draft={store} />);

    await waitFor(() =>
      expect(screen.getByLabelText(/nombre/i)).toHaveValue('Hooli'),
    );
    await user.type(screen.getByLabelText(/nombre/i), '!');
    await waitFor(() => expect(store.save).toHaveBeenCalled());
  });

  // The draft is spent once the write commits, and this page is the only place
  // that knows it did — `useEntityForm` neither fetches nor saves.
  it('clears the draft once a save commits', async () => {
    slug = 'b-1';
    const store = draftStore();
    const user = userEvent.setup();

    renderPage(<brandCrud.SingleViewPage slug="b-1" draft={store} />);
    await waitFor(() =>
      expect(screen.getByLabelText(/nombre/i)).toHaveValue('Acme'),
    );

    await user.click(screen.getByRole('button', { name: 'Guardar' }));

    await waitFor(() => expect(store.clear).toHaveBeenCalledTimes(1));
  });

  it('clears the draft once a delete commits', async () => {
    slug = 'b-1';
    const store = draftStore();
    const user = userEvent.setup();

    renderPage(<brandCrud.SingleViewPage slug="b-1" draft={store} />);
    await waitFor(() =>
      expect(screen.getByLabelText(/nombre/i)).toHaveValue('Acme'),
    );

    await press(user, 'Eliminar');

    await waitFor(() => expect(store.clear).toHaveBeenCalledTimes(1));
  });

  /**
   * A failed write leaves the draft alone: what the user typed is still their
   * only copy of it, and clearing here would discard the edit at the exact
   * moment they need to retry it.
   */
  it('keeps the draft when the save fails', async () => {
    slug = 'b-1';
    const store = draftStore();
    const user = userEvent.setup();

    renderPage(<brandCrud.SingleViewPage slug="b-1" draft={store} />);
    await waitFor(() =>
      expect(screen.getByLabelText(/nombre/i)).toHaveValue('Acme'),
    );
    repositories.brand.failNext(new Unavailable({ dependency: 'unreachable' }));

    await user.click(screen.getByRole('button', { name: 'Guardar' }));

    await waitFor(() =>
      expect(screen.getByTestId('region-state-error')).toBeInTheDocument(),
    );
    expect(store.clear).not.toHaveBeenCalled();
  });
});

describe('the generated form’s pickers', () => {
  const held = () => screen.getByTestId('entity-link-value-brandId');

  // No `labelProperty`/`searchProperty` on the link above, so both fall back to
  // `'name'` — the default a scalar id's accessor cannot state for itself.
  it('resolves a held id to its target’s name through the default property', async () => {
    const product = new Product('Widget');
    product.id = 'p-1';
    product.brandId = 'b-1';
    repositories.product = makeInMemoryEntityRepository([product] as Entity[]);
    slug = 'p-1';

    renderPage(<productCrud.SingleViewPage />);

    await waitFor(() => expect(held()).toHaveTextContent('Acme'));
  });

  // Nothing enforces the reference across a store boundary, so a deleted target
  // leaves an id pointing at nothing. That is a display gap, never a corrupt
  // record, and the field has to keep showing the key.
  it('falls back to the bare id when the target no longer exists', async () => {
    const orphan = new Product('Gizmo');
    orphan.id = 'p-2';
    orphan.brandId = 'b-404';
    repositories.product = makeInMemoryEntityRepository([orphan] as Entity[]);
    slug = 'p-2';

    renderPage(<productCrud.SingleViewPage />);

    await waitFor(() => expect(held()).toHaveTextContent('b-404'));
  });

  // An empty draft entry is "unset", not an id: nothing enforces the reference,
  // so `''` would be a dangling key rather than an absent one.
  it('treats an unset classification as nothing selected', async () => {
    const bare = new Product('Gadget');
    bare.id = 'p-3';
    repositories.product = makeInMemoryEntityRepository([bare] as Entity[]);
    slug = 'p-3';

    renderPage(<productCrud.SingleViewPage />);

    await waitFor(() =>
      expect(screen.getByLabelText(/nombre/i)).toHaveValue('Gadget'),
    );
    expect(held()).toHaveTextContent('sin asignar');
  });

  it('writes the picked target’s id into the record', async () => {
    const bare = new Product('Gadget');
    bare.id = 'p-3';
    repositories.product = makeInMemoryEntityRepository([bare] as Entity[]);
    slug = 'p-3';
    const user = userEvent.setup();
    renderPage(<productCrud.SingleViewPage />);
    await waitFor(() =>
      expect(screen.getByLabelText(/nombre/i)).toHaveValue('Gadget'),
    );

    // The picker labels itself from the *target's* `@entity({ labelKey })`.
    await user.type(screen.getByLabelText('Buscar Marca'), 'Acme');
    await user.click(await screen.findByRole('option', { name: 'Acme' }));
    await user.click(screen.getByRole('button', { name: 'Guardar' }));

    await waitFor(() => expect(push).toHaveBeenCalledTimes(1));
    expect((repositories.product.items[0] as Product).brandId).toBe('b-1');
  });
});

describe('the generated form’s pickers, filtered per record', () => {
  beforeEach(() => {
    brandFilterFor.mockClear();
    repositories.brand.seed([
      makeBrand('b-1', 'Acme'),
      makeBrand('b-2', 'Acorn'),
    ] as Entity[]);
  });

  const suggestionsFor = async (term: string) => {
    const user = userEvent.setup();
    await user.type(screen.getByLabelText('Buscar Marca'), term);
    await screen.findByRole('option', { name: 'Acorn' });
    return screen.getAllByRole('option').map(option => option.textContent);
  };

  it('leaves out what the rule refuses for the record being edited', async () => {
    const product = new Product('Widget');
    product.id = 'p-1';
    repositories.product = makeInMemoryEntityRepository([product] as Entity[]);
    slug = 'p-1';
    renderPage(<filteredProductCrud.SingleViewPage />);
    await waitFor(() =>
      expect(screen.getByLabelText(/nombre/i)).toHaveValue('Widget'),
    );

    expect(await suggestionsFor('Ac')).toEqual(['Acorn']);
    expect(brandFilterFor).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'p-1' }),
    );
  });

  it('offers everything when the rule has nothing to refuse', async () => {
    const product = new Product('Gizmo');
    product.id = 'p-2';
    repositories.product = makeInMemoryEntityRepository([product] as Entity[]);
    slug = 'p-2';
    renderPage(<filteredProductCrud.SingleViewPage />);
    await waitFor(() =>
      expect(screen.getByLabelText(/nombre/i)).toHaveValue('Gizmo'),
    );

    expect(await suggestionsFor('Ac')).toEqual(['Acme', 'Acorn']);
  });

  // There is no record yet, so the rule is asked about nothing — and, being a
  // hook, it is asked all the same.
  it('asks the rule about no record on the create form', async () => {
    renderPage(<filteredProductCrud.SingleViewPage />);

    expect(await suggestionsFor('Ac')).toEqual(['Acme', 'Acorn']);
    expect(brandFilterFor).toHaveBeenCalledWith(undefined);
    expect(brandFilterFor).not.toHaveBeenCalledWith(expect.anything());
  });
});

describe('the generated form, saving a write that settled', () => {
  // A settled save is durable when it answers, so the draft is spent.
  it('clears the draft', async () => {
    slug = 'b-1';
    const store = draftStore();
    const user = userEvent.setup();

    renderPage(<brandCrud.SingleViewPage draft={store} />);
    await waitFor(() =>
      expect(screen.getByLabelText(/nombre/i)).toHaveValue('Acme'),
    );

    await user.click(screen.getByRole('button', { name: 'Guardar' }));

    await waitFor(() => expect(store.clear).toHaveBeenCalledTimes(1));
  });
});

describe('makeEntityCrud, with the metadata source named by adapter key', () => {
  it('reads the served document through the host’s adapters', async () => {
    slug = 'b-1';
    fetchMetadata
      .mockReset()
      .mockResolvedValue({ actions: ['read'], useCases: [] });

    renderPage(<keyedBrandCrud.SingleViewPage />);

    await waitFor(() => expect(screen.getByText('Acme')).toBeInTheDocument());
    expect(fetchMetadata).toHaveBeenCalled();
    expect(
      screen.queryByRole('button', { name: /guardar/i }),
    ).not.toBeInTheDocument();
  });

  it('filters the list against the same document', async () => {
    fetchMetadata
      .mockReset()
      .mockResolvedValue({ actions: ['read'], useCases: [] });

    renderPage(<keyedBrandCrud.ListPage />);

    await waitFor(() =>
      expect(screen.getAllByText('Acme').length).toBeGreaterThan(0),
    );
    expect(fetchMetadata).toHaveBeenCalled();
  });
});

describe('the generated form, writing through a writer that answers both modes', () => {
  const writtenBrandCrud = makeEntityCrud<Brand, TestAdapters>(Brand, {
    useAdapters,
    basePath: '/catalog/brand',
    catalogKey: 'product-brand',
    repository: 'brandRest',
    write: 'brandWrite',
    hiddenFields: ['id', 'code'],
    metadataSource: { fetchMetadata: () => fetchMetadata() },
    useCases: 'brandVerbs',
  });

  const PUBLISH = {
    key: 'publish',
    binding: 'entity' as const,
    placement: 'context-independent' as const,
    labelKey: 'entity:product-brand.useCases.retire',
  };

  const flowEvent = (
    name: 'flow.completed' | 'flow.failed',
    failure?: { code: string; category: string },
  ): DomainEvent => ({
    name,
    id: `f-1:${name}`,
    source: 'catalog',
    at: '2026-11-02T10:00:01.000Z',
    data: {
      flowId: 'f-1',
      definition: 'brand',
      slipVersion: 1,
      ...(failure === undefined ? {} : { failure }),
    },
  });

  const memoryStorage = () => {
    const items = new Map<string, string>();
    return {
      getItem: (name: string) => items.get(name) ?? null,
      setItem: (name: string, value: string) => {
        items.set(name, value);
      },
    };
  };

  /** The page under the providers a host mounts once, around every route. */
  const renderWithFlows = (
    page: ReactElement | null,
    readStatus?: FlowStatusRead,
  ) => {
    const channel = makeInMemoryPushChannel();
    const storage = memoryStorage();
    const tree = (inner: ReactElement | null) => (
      <EntifixQueryProvider>
        <ToastProvider>
          <PendingFlowsProvider
            scope="u-1:-"
            channel={channel}
            storage={storage}
            {...(readStatus === undefined ? {} : { readStatus })}
          >
            {inner}
          </PendingFlowsProvider>
          <ToastRegion />
        </ToastProvider>
      </EntifixQueryProvider>
    );
    const view = render(tree(page));
    return {
      channel,
      leave: () => view.rerender(tree(null)),
      // The flow's topic is subscribed once the store has recorded it.
      flowWatched: () =>
        waitFor(() => expect(channel.topics()).toEqual(['flow:f-1'])),
    };
  };

  beforeEach(() => {
    fetchMetadata.mockReset().mockResolvedValue({
      actions: ['read', 'write', 'delete'],
      useCases: [PUBLISH],
    });
  });

  const typeName = async (name: string) => {
    const user = userEvent.setup();
    const field = await screen.findByLabelText(/nombre/i);
    await user.clear(field);
    await user.type(field, name);
    await user.click(screen.getByRole('button', { name: 'Guardar' }));
  };

  it('keeps a failed pending create on its form, with its input and one translated toast', async () => {
    writeSave.mockResolvedValue(pending('f-1'));
    const draft = draftStore();
    const { channel, flowWatched } = renderWithFlows(
      <writtenBrandCrud.SingleViewPage draft={draft} />,
    );

    await typeName('Hooli');

    expect(
      await screen.findByRole('button', { name: 'Esperando al servidor…' }),
    ).toBeDisabled();
    await flowWatched();

    const failed = flowEvent('flow.failed', {
      code: 'alreadyRetired',
      category: 'declined',
    });
    act(() => {
      channel.emit(['flow:f-1'], failed);
      channel.emit(['flow:f-1'], failed);
    });

    const alerts = await screen.findAllByRole('alert');
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toHaveTextContent(/ya estaba retirado/i);
    expect(screen.getByLabelText(/nombre/i)).toHaveValue('Hooli');
    expect(screen.queryByTestId('region-state-error')).toBeNull();
    expect(screen.getByRole('button', { name: 'Guardar' })).not.toBeDisabled();
    expect(draft.clear).not.toHaveBeenCalled();
    expect(push).not.toHaveBeenCalled();
  });

  it('returns to the list once a pending create completes', async () => {
    writeSave.mockResolvedValue(pending('f-1'));
    const draft = draftStore();
    const { channel, flowWatched } = renderWithFlows(
      <writtenBrandCrud.SingleViewPage draft={draft} />,
    );

    await typeName('Hooli');
    await flowWatched();
    act(() => channel.emit(['flow:f-1'], flowEvent('flow.completed')));

    await waitFor(() => expect(push).toHaveBeenCalledWith('/es/catalog/brand'));
    expect(draft.clear).toHaveBeenCalledTimes(1);
  });

  it('does not pull an operator who already left back to the list', async () => {
    writeSave.mockResolvedValue(pending('f-1'));
    const draft = draftStore();
    const { channel, flowWatched, leave } = renderWithFlows(
      <writtenBrandCrud.SingleViewPage draft={draft} />,
    );

    await typeName('Hooli');
    await flowWatched();
    leave();
    act(() => channel.emit(['flow:f-1'], flowEvent('flow.completed')));

    await waitFor(() => expect(draft.clear).toHaveBeenCalledTimes(1));
    expect(push).not.toHaveBeenCalled();
  });

  it('returns to the list at once when the writer settles', async () => {
    writeSave.mockImplementation(entity => Promise.resolve(settled(entity)));
    renderWithFlows(<writtenBrandCrud.SingleViewPage />);

    await typeName('Hooli');

    await waitFor(() => expect(push).toHaveBeenCalledWith('/es/catalog/brand'));
    expect(writeSave.mock.calls[0]?.[0]).toMatchObject({ name: 'Hooli' });
  });

  it('deletes through the writer, settled or once its flow completes', async () => {
    slug = 'b-1';
    writeDelete.mockResolvedValueOnce(settled(undefined));
    const user = userEvent.setup();
    const loaded = () =>
      waitFor(() =>
        expect(screen.getByLabelText(/nombre/i)).toHaveValue('Acme'),
      );
    const first = renderWithFlows(<writtenBrandCrud.SingleViewPage />);

    await loaded();
    await press(user, 'Eliminar');
    await waitFor(() => expect(push).toHaveBeenCalledTimes(1));
    expect(writeDelete).toHaveBeenCalledWith('b-1');
    first.leave();

    writeDelete.mockResolvedValueOnce(pending('f-1'));
    const { channel, flowWatched } = renderWithFlows(
      <writtenBrandCrud.SingleViewPage />,
    );
    await loaded();
    await press(user, 'Eliminar');
    await flowWatched();
    act(() => channel.emit(['flow:f-1'], flowEvent('flow.completed')));

    await waitFor(() => expect(push).toHaveBeenCalledTimes(2));
  });

  it('does not navigate for a pending delete that completes after its form was left', async () => {
    slug = 'b-1';
    writeDelete.mockResolvedValue(pending('f-1'));
    const user = userEvent.setup();
    const draft = draftStore();
    const { channel, flowWatched, leave } = renderWithFlows(
      <writtenBrandCrud.SingleViewPage draft={draft} />,
    );

    await waitFor(() =>
      expect(screen.getByLabelText(/nombre/i)).toHaveValue('Acme'),
    );
    await press(user, 'Eliminar');
    await flowWatched();
    leave();
    act(() => channel.emit(['flow:f-1'], flowEvent('flow.completed')));

    await waitFor(() => expect(draft.clear).toHaveBeenCalledTimes(1));
    expect(push).not.toHaveBeenCalled();
  });

  it('settles a pending create from its status read when the push was missed', async () => {
    writeSave.mockResolvedValue(
      pending('f-1', [{ rel: 'status', href: '/api/flow/f-1' }]),
    );
    const readStatus = vi.fn<FlowStatusRead>(() =>
      Effect.succeed({ flowId: 'f-1', state: 'completed' }),
    );
    const { channel, flowWatched } = renderWithFlows(
      <writtenBrandCrud.SingleViewPage />,
      readStatus,
    );

    await typeName('Hooli');
    await flowWatched();
    act(() => channel.connect());

    await waitFor(() => expect(push).toHaveBeenCalledWith('/es/catalog/brand'));
    expect(readStatus).toHaveBeenCalledWith('/api/flow/f-1');
  });

  it('reloads a record once the flow a verb was handed to completes', async () => {
    slug = 'b-1';
    runVerb.mockResolvedValue(pending('f-1'));
    const { channel, flowWatched } = renderWithFlows(
      <writtenBrandCrud.SingleViewPage />,
    );

    fireEvent.click(await screen.findByRole('button', { name: /retirar/i }));
    expect(
      await screen.findByRole('button', { name: 'Esperando al servidor…' }),
    ).toBeDisabled();
    await flowWatched();

    await Effect.runPromise(
      repositories.brand.save(makeBrand('b-1', 'Acme Retirada', 'brand-001')),
    );
    act(() => channel.emit(['flow:f-1'], flowEvent('flow.completed')));

    await waitFor(() =>
      expect(screen.getByLabelText(/nombre/i)).toHaveValue('Acme Retirada'),
    );
  });

  it('re-reads the rows once a row verb’s flow completes', async () => {
    const user = userEvent.setup();
    const ARCHIVE = {
      ...PUBLISH,
      key: 'archive',
      placement: 'context-dependent' as const,
    };
    fetchMetadata.mockReset().mockResolvedValue({
      actions: ['read'],
      useCases: [ARCHIVE],
    });
    runVerb.mockResolvedValue(pending('f-1'));
    const { channel, flowWatched } = renderWithFlows(
      <writtenBrandCrud.ListPage />,
    );

    await waitFor(() =>
      expect(screen.getAllByText('Acme').length).toBeGreaterThan(0),
    );
    await user.click(
      screen.getAllByRole('button', { name: /^Acciones para / })[0]!,
    );
    await user.click(screen.getByRole('menuitem', { name: /retirar/i }));
    await flowWatched();

    await Effect.runPromise(
      repositories.brand.save(makeBrand('b-1', 'Acme Archivada', 'brand-001')),
    );
    act(() => channel.emit(['flow:f-1'], flowEvent('flow.completed')));

    await waitFor(() =>
      expect(screen.getAllByText('Acme Archivada').length).toBeGreaterThan(0),
    );
  });

  it('refuses a pending write it has no store to wait in, on the form', async () => {
    writeSave.mockResolvedValue(pending('f-1'));
    renderPage(<writtenBrandCrud.SingleViewPage />);

    await typeName('Hooli');

    await waitFor(() =>
      expect(screen.getByText('Algo falló de nuestro lado.')).toBeVisible(),
    );
    expect(screen.getByLabelText(/nombre/i)).toHaveValue('Hooli');
  });

  it('refuses to wait on flows with no toast region to report them in', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(() =>
      render(
        <PendingFlowsProvider scope="u-1:-" channel={makeInMemoryPushChannel()}>
          {null}
        </PendingFlowsProvider>,
      ),
    ).toThrow(/inside a ToastProvider/);
  });
});

describe('the generated Delete (ADR 0026)', () => {
  const undoCrud = makeEntityCrud<Brand, TestAdapters>(Brand, {
    useAdapters,
    basePath: '/catalog/product-brand',
    catalogKey: 'product-brand',
    repository: 'brandRest',
    hiddenFields: ['id', 'code'],
    delete: 'undo',
  });
  const undoThroughWriterCrud = makeEntityCrud<Brand, TestAdapters>(Brand, {
    useAdapters,
    basePath: '/catalog/product-brand',
    catalogKey: 'product-brand',
    repository: 'brandRest',
    hiddenFields: ['id', 'code'],
    write: 'brandWrite',
    delete: 'undo',
  });

  const withToasts = (page: ReactElement) =>
    render(
      <EntifixQueryProvider>
        <ToastProvider>
          {page}
          <ToastRegion />
        </ToastProvider>
      </EntifixQueryProvider>,
    );

  it('confirms, announces the deletion by name, and focuses the list heading', async () => {
    slug = 'b-1';
    const user = userEvent.setup();
    const { unmount } = withToasts(<brandCrud.SingleViewPage />);
    await waitFor(() =>
      expect(screen.getByLabelText(/nombre/i)).toHaveValue('Acme'),
    );

    await press(user, 'Eliminar');

    await waitFor(() => expect(push).toHaveBeenCalledTimes(1));
    expect(
      within(screen.getByTestId('toast-region')).getByRole('status'),
    ).toHaveTextContent('Se eliminó Acme.');
    unmount();

    renderPage(<brandCrud.ListPage />);
    expect(screen.getByRole('heading', { level: 1 })).toHaveFocus();
  });

  it('announces a save by name', async () => {
    slug = 'b-1';
    const user = userEvent.setup();
    withToasts(<brandCrud.SingleViewPage />);
    await waitFor(() =>
      expect(screen.getByLabelText(/nombre/i)).toHaveValue('Acme'),
    );

    await user.click(screen.getByRole('button', { name: 'Guardar' }));

    await waitFor(() => expect(push).toHaveBeenCalledTimes(1));
    expect(
      within(screen.getByTestId('toast-region')).getByRole('status'),
    ).toHaveTextContent('Se guardó Acme.');
  });

  it('retries a record that failed to load', async () => {
    slug = 'b-1';
    repositories.brand.failNext(new Unavailable({}));
    const user = userEvent.setup();
    renderPage(<brandCrud.SingleViewPage />);

    await user.click(await screen.findByRole('button', { name: 'Reintentar' }));

    await waitFor(() =>
      expect(screen.getByLabelText(/nombre/i)).toHaveValue('Acme'),
    );
  });

  it('retries a list that failed to load', async () => {
    repositories.brand.failNext(new Unavailable({}));
    const user = userEvent.setup();
    renderPage(<brandCrud.ListPage />);

    await user.click(await screen.findByRole('button', { name: 'Reintentar' }));

    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'Reintentar' })).toBeNull(),
    );
    expect(screen.getAllByText('Acme').length).toBeGreaterThan(0);
  });

  it('leaves focus where the reader put it', () => {
    render(<button type="button">Pestaña</button>);
    screen.getByRole('button', { name: 'Pestaña' }).focus();
    renderPage(<brandCrud.ListPage />);

    expect(screen.getByRole('heading', { level: 1 })).not.toHaveFocus();
  });

  it('deletes at once under undo, and Undo saves the record back', async () => {
    slug = 'b-1';
    const user = userEvent.setup();
    withToasts(<undoCrud.SingleViewPage />);
    await waitFor(() =>
      expect(screen.getByLabelText(/nombre/i)).toHaveValue('Acme'),
    );

    await user.click(screen.getByRole('button', { name: 'Eliminar' }));
    await waitFor(() => expect(push).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(repositories.brand.items).toHaveLength(0);

    await user.click(screen.getByRole('button', { name: 'Deshacer' }));
    await waitFor(() => expect(repositories.brand.items).toHaveLength(1));
  });

  it('names the entity when the deleted record has nothing filled in to name it by', async () => {
    slug = 'b-2';
    repositories.brand.seed([makeBrand('b-2', '')]);
    const user = userEvent.setup();
    withToasts(<undoCrud.SingleViewPage />);
    await waitFor(() =>
      expect(screen.getByLabelText(/nombre/i)).toHaveValue(''),
    );

    await user.click(screen.getByRole('button', { name: 'Eliminar' }));

    await waitFor(() => expect(push).toHaveBeenCalledTimes(1));
    expect(
      within(screen.getByTestId('toast-region')).getByRole('status'),
    ).toHaveTextContent('Se eliminó Marca.');
  });

  it('shows a failed Undo where every failure is shown', async () => {
    slug = 'b-1';
    writeDelete.mockResolvedValue(settled(undefined));
    writeSave.mockRejectedValue(new Error('the store refused it'));
    const user = userEvent.setup();
    withToasts(<undoThroughWriterCrud.SingleViewPage />);
    await waitFor(() =>
      expect(screen.getByLabelText(/nombre/i)).toHaveValue('Acme'),
    );

    await user.click(screen.getByRole('button', { name: 'Eliminar' }));
    await user.click(await screen.findByRole('button', { name: 'Deshacer' }));

    expect(await screen.findByRole('alert')).toBeInTheDocument();
  });
});
