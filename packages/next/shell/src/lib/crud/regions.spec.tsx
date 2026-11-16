import { EntityRepositoryTag } from '@entifix/business';
import {
  accessor,
  type EntifixFailure,
  type Entity,
  entity,
  type EntityId,
  type EntityMetadataSource,
  type EntityUseCaseRunner,
  type WriteResult,
} from '@entifix/core';
import { EntifixQueryProvider } from '@entifix/react-integration';
import { makeInMemoryEntityRepository } from '@entifix/testing-unit';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Context, Effect } from 'effect';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useRegion } from './index.js';
import { makeEntityCrud } from './make-entity-crud.js';
import { PREFILL_PARAM, readPrefill } from './regions.js';

const push = vi.fn();
let slug = 'a-1';
let searchParams = new URLSearchParams();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push }),
  useParams: () => ({ slug }),
  useSearchParams: () => searchParams,
}));

/** A record's values, read and written by every accessor below. */
class Values implements Entity {
  values: Record<string, unknown>;
  constructor(values: Record<string, unknown> = {}) {
    this.values = { ...values };
  }
  protected read(name: string): never {
    return this.values[name] as never;
  }
  @accessor({ type: 'id', filterable: true, hidden: false })
  get id(): EntityId {
    return this.read('id');
  }
  set id(value: EntityId) {
    this.values['id'] = value;
  }
}

@entity({
  domain: 'crm',
  key: 'account',
  labelKey: 'entity:account.label',
  pluralKey: 'entity:account.plural',
  labelMember: 'name',
})
class Account extends Values {
  @accessor({ type: 'string', required: true })
  get name(): string {
    return this.read('name');
  }
  set name(value: string) {
    this.values['name'] = value;
  }
}

/** A child entity in another store: it refers to an account by id. */
function child(key: string) {
  @entity({
    domain: 'crm',
    key,
    labelKey: `entity:${key}.label`,
    pluralKey: `entity:${key}.plural`,
    labelMember: 'title',
  })
  class Child extends Values {
    @accessor({ type: 'string' })
    get title(): string {
      return this.read('title');
    }
    set title(value: string) {
      this.values['title'] = value;
    }
    @accessor({
      type: 'string',
      filterable: true,
      references: { entity: 'crm:account' },
    })
    get accountId(): string {
      return this.read('accountId');
    }
    set accountId(value: string) {
      this.values['accountId'] = value;
    }
    @accessor({ type: 'string', readonly: true })
    get stamp(): string {
      return this.read('stamp');
    }
    set stamp(value: string) {
      this.values['stamp'] = value;
    }
  }
  return Child;
}

const Note = child('note');
const Task = child('task');

const ARCHIVE = {
  key: 'archive',
  binding: 'entity' as const,
  placement: 'context-dependent' as const,
  labelKey: 'entity:note.useCases.archive',
};

const runVerb = vi.fn();
const noteVerbs: EntityUseCaseRunner = {
  run: (useCase, id) =>
    Effect.tryPromise({
      try: () => runVerb(useCase.key, id) as Promise<WriteResult<unknown>>,
      catch: failure => failure as EntifixFailure,
    }),
  bulk: () => Effect.die('not used'),
};
const noteMetadata: EntityMetadataSource = {
  fetchMetadata: () =>
    Promise.resolve({ actions: ['read', 'write'], useCases: [ARCHIVE] }),
} as never;

let repositories: Record<
  'accounts' | 'notes' | 'tasks',
  ReturnType<typeof makeInMemoryEntityRepository>
>;

interface Adapters {
  accounts: Context.Context<EntityRepositoryTag>;
  notes: Context.Context<EntityRepositoryTag>;
  tasks: Context.Context<EntityRepositoryTag>;
  noteVerbs: EntityUseCaseRunner;
  noteMetadata: EntityMetadataSource;
}

const useAdapters = (): Adapters => ({
  accounts: Context.make(EntityRepositoryTag, repositories.accounts),
  notes: Context.make(EntityRepositoryTag, repositories.notes),
  tasks: Context.make(EntityRepositoryTag, repositories.tasks),
  noteVerbs,
  noteMetadata,
});

const noteCrud = makeEntityCrud(Note, {
  useAdapters,
  basePath: '/notes',
  catalogKey: 'note',
  repository: 'notes',
  useCases: 'noteVerbs',
  metadata: 'noteMetadata',
});
const taskCrud = makeEntityCrud(Task, {
  useAdapters,
  basePath: '/tasks',
  catalogKey: 'task',
  repository: 'tasks',
});

const byAccount = (record: Entity) => ({
  operator: 'and' as const,
  values: [
    {
      property: 'accountId' as const,
      operator: 'eq' as const,
      value: String(record.id),
    },
  ],
});

const accountCrud = makeEntityCrud(Account, {
  useAdapters,
  basePath: '/accounts',
  catalogKey: 'account',
  repository: 'accounts',
  regions: account => [
    <noteCrud.RelatedList
      key="notes"
      labelKey="entity:note.region"
      filtering={byAccount(account) as never}
      prefill={{ accountId: String(account.id) }}
    />,
    <taskCrud.RelatedList
      key="tasks"
      labelKey="entity:task.region"
      filtering={byAccount(account) as never}
      pageSize={5}
    />,
  ],
});

/** One region only: no section nav, since there is nothing to move between. */
const oneRegionCrud = makeEntityCrud(Account, {
  useAdapters,
  basePath: '/accounts',
  catalogKey: 'account',
  repository: 'accounts',
  regions: account => [
    <noteCrud.RelatedList
      key="notes"
      labelKey="entity:note.region"
      filtering={byAccount(account) as never}
      newHref="/elsewhere"
    />,
  ],
});

/** A region the host writes itself: not a related list, still in the nav. */
function PicturesRegion() {
  useRegion('pictures', 'Pictures');
  return (
    <section id="pictures" aria-labelledby="pictures-heading">
      <h2 id="pictures-heading">Pictures</h2>
    </section>
  );
}

const hostRegionCrud = makeEntityCrud(Account, {
  useAdapters,
  basePath: '/accounts',
  catalogKey: 'account',
  repository: 'accounts',
  regions: account => [
    <PicturesRegion key="pictures" />,
    <noteCrud.RelatedList
      key="notes"
      labelKey="entity:note.region"
      filtering={byAccount(account) as never}
    />,
  ],
});

beforeEach(() => {
  slug = 'a-1';
  searchParams = new URLSearchParams();
  runVerb.mockReset();
  repositories = {
    accounts: makeInMemoryEntityRepository([
      new Account({ id: 'a-1', name: 'Acme' }),
    ]),
    notes: makeInMemoryEntityRepository([
      new Note({ id: 'n-1', title: 'Call back', accountId: 'a-1' }),
      new Note({ id: 'n-2', title: 'Elsewhere', accountId: 'a-2' }),
    ]),
    tasks: makeInMemoryEntityRepository([
      new Task({ id: 't-1', title: 'Ship', accountId: 'a-1' }),
    ]),
  };
  vi.stubGlobal(
    'IntersectionObserver',
    class {
      observe = vi.fn();
      disconnect = vi.fn();
    },
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const renderPage = (page: React.ReactElement) =>
  render(<EntifixQueryProvider>{page}</EntifixQueryProvider>);

describe('a record page’s related regions (ADR 0030)', () => {
  it('composes a labelled section per region, under a section nav', async () => {
    renderPage(<accountCrud.SingleViewPage />);

    const notes = await screen.findByRole('region', { name: 'note.region' });
    const tasks = screen.getByRole('region', { name: 'task.region' });
    expect(
      within(notes).getByRole('heading', { level: 2, name: 'note.region' }),
    ).toBeInTheDocument();
    const nav = screen.getByRole('navigation', {
      name: 'Secciones del registro',
    });
    expect(
      within(nav).getByRole('link', { name: 'note.region' }),
    ).toHaveAttribute('href', `#${notes.id}`);
    expect(
      within(nav).getByRole('link', { name: 'task.region' }),
    ).toHaveAttribute('href', `#${tasks.id}`);

    // Held to this account, with the filter shown as no chip.
    await waitFor(() =>
      expect(within(notes).getAllByText('Call back').length).toBeGreaterThan(0),
    );
    expect(within(notes).queryByText('Elsewhere')).not.toBeInTheDocument();
    expect(within(notes).queryByRole('button', { name: /Quitar/ })).toBeNull();
  });

  it('opens a New from a region with the parent record already set', async () => {
    renderPage(<accountCrud.SingleViewPage />);
    const notes = await screen.findByRole('region', { name: 'note.region' });
    await waitFor(() =>
      expect(
        within(notes).getByRole('link', { name: 'Nuevo' }),
      ).toHaveAttribute('href', `/es/notes/new?${PREFILL_PARAM}accountId=a-1`),
    );
  });

  it('shows no section nav for a single region, and keeps a given New', async () => {
    renderPage(<oneRegionCrud.SingleViewPage />);
    const notes = await screen.findByRole('region', { name: 'note.region' });
    expect(
      screen.queryByRole('navigation', { name: 'Secciones del registro' }),
    ).not.toBeInTheDocument();
    await waitFor(() =>
      expect(
        within(notes).getByRole('link', { name: 'Nuevo' }),
      ).toHaveAttribute('href', '/es/elsewhere'),
    );
  });

  it('lists a region the host writes beside a related list', async () => {
    renderPage(<hostRegionCrud.SingleViewPage />);
    await screen.findByRole('region', { name: 'note.region' });
    const nav = await screen.findByRole('navigation', {
      name: 'Secciones del registro',
    });
    expect(within(nav).getByRole('link', { name: 'Pictures' })).toHaveAttribute(
      'href',
      '#pictures',
    );
    expect(
      within(nav)
        .getAllByRole('link')
        .map(link => link.textContent),
    ).toEqual(['Pictures', 'note.region']);
  });

  it('renders no regions on a create', () => {
    slug = 'new';
    renderPage(<accountCrud.SingleViewPage />);
    expect(screen.queryByRole('region', { name: 'note.region' })).toBeNull();
  });

  it('moves focus to its own heading when a verb settles inside it', async () => {
    const user = userEvent.setup();
    runVerb.mockResolvedValue({ _tag: 'settled', value: undefined });
    renderPage(<accountCrud.SingleViewPage />);
    const notes = await screen.findByRole('region', { name: 'note.region' });
    await waitFor(() =>
      expect(
        within(notes).getAllByRole('button', { name: /^Acciones para / })
          .length,
      ).toBeGreaterThan(0),
    );

    await user.click(
      within(notes).getAllByRole('button', { name: /^Acciones para / })[0]!,
    );
    await user.click(
      screen.getByRole('menuitem', { name: 'note.useCases.archive' }),
    );

    await waitFor(() =>
      expect(
        within(notes).getByRole('heading', { level: 2, name: 'note.region' }),
      ).toHaveFocus(),
    );
    expect(runVerb).toHaveBeenCalledWith('archive', 'n-1');
  });
});

describe('a prefilled create', () => {
  it('starts with the members the query names', async () => {
    slug = 'new';
    searchParams = new URLSearchParams(
      `${PREFILL_PARAM}accountId=a-1&${PREFILL_PARAM}nope=x&other=y`,
    );
    renderPage(<noteCrud.SingleViewPage />);
    await waitFor(() =>
      expect(screen.getByDisplayValue('a-1')).toBeInTheDocument(),
    );
    // An edit with no host draft store to keep it is kept nowhere, quietly.
    await userEvent.type(screen.getByDisplayValue('a-1'), '0');
    expect(screen.getByDisplayValue('a-10')).toBeInTheDocument();
  });

  it('reads only declared, writable members', () => {
    const descriptors = [
      { name: 'accountId', readonly: false },
      { name: 'stamp', readonly: true },
    ] as never;
    expect(
      readPrefill(
        new URLSearchParams(
          `${PREFILL_PARAM}accountId=a-1&${PREFILL_PARAM}stamp=s&${PREFILL_PARAM}nope=x&q=1`,
        ),
        descriptors,
      ),
    ).toEqual({ accountId: 'a-1' });
    expect(
      readPrefill(new URLSearchParams('q=1'), descriptors),
    ).toBeUndefined();
    expect(readPrefill(null, descriptors)).toBeUndefined();
  });
});
