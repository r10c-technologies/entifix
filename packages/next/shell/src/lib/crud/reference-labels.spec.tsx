import {
  EntityRepositoryTag,
  type ReferenceLabelRegistration,
} from '@entifix/business';
import {
  accessor,
  type Entity,
  entity,
  type EntityId,
  type EntityLoadRequest,
  Unavailable,
} from '@entifix/core';
import {
  CellValue,
  useRecordLabel,
  useReferenceLabels,
} from '@entifix/react-controls';
import { EntifixQueryProvider } from '@entifix/react-integration';
import { makeInMemoryEntityRepository } from '@entifix/testing-unit';
import { render, screen, waitFor } from '@testing-library/react';
import { Context, Effect } from 'effect';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { ReferenceLabelsHost } from './reference-labels.js';

/**
 * A record's values, read and written by every accessor below — the in-memory
 * repository copies a record through its setters.
 */
class Values implements Entity {
  values: Record<string, unknown>;
  constructor(values: Record<string, unknown> = {}) {
    this.values = { ...values };
  }
  protected read(name: string): never {
    return this.values[name] as never;
  }
  @accessor({ type: 'id', filterable: true })
  get id(): EntityId {
    return this.read('id');
  }
  set id(value: EntityId) {
    this.values['id'] = value;
  }
}

@entity({ domain: 'catalog', key: 'offering', labelMember: 'title' })
class Offering extends Values {
  @accessor({ type: 'string' })
  get title(): string {
    return this.read('title');
  }
  set title(value: string) {
    this.values['title'] = value;
  }
}

@entity({ domain: 'catalog', key: 'brand', labelMember: 'name' })
class Brand extends Values {
  @accessor({ type: 'string' })
  get name(): string {
    return this.read('name');
  }
  set name(value: string) {
    this.values['name'] = value;
  }
}

const OFFERING = {
  name: 'offeringId',
  key: 'offeringId',
  label: 'Offering',
  type: 'string',
  sortable: true,
  filterable: true,
  order: 0,
  readonly: false,
  required: false,
  linkLabelProperty: 'name',
  linkSearchProperty: 'name',
  linkSerialization: 'id',
  resetOnClone: false,
  references: { entity: 'catalog:offering' },
} as const;
const BRAND = { ...OFFERING, references: { entity: 'catalog:brand' } };
const ORDER = { ...OFFERING, references: { entity: 'sales:order' } };

/** A repository whose loads are counted, which is what this host keeps low. */
function counted(items: Entity[], fail = false) {
  const repository = makeInMemoryEntityRepository(items);
  const load = vi.fn((request: EntityLoadRequest<Entity>) =>
    fail
      ? Effect.fail(new Unavailable({ dependency: 'catalog' }))
      : repository.load(request),
  );
  return {
    load,
    context: Context.make(EntityRepositoryTag, {
      ...repository,
      load,
    } as never),
  };
}

const offerings = Array.from(
  { length: 25 },
  (_, index) => new Offering({ id: `o-${index}`, title: `Offering ${index}` }),
);
const brands = Array.from(
  { length: 25 },
  (_, index) => new Brand({ id: `b-${index}`, name: `Brand ${index}` }),
);

function Rows({ ids }: { ids: readonly [string, string][] }) {
  return (
    <ul>
      {ids.map(([kind, id]) => (
        <li key={`${kind}${id}`}>
          <CellValue
            value={id}
            descriptor={kind === 'o' ? OFFERING : kind === 'b' ? BRAND : ORDER}
          />
        </li>
      ))}
    </ul>
  );
}

const page: [string, string][] = [
  ...offerings.map(item => ['o', String(item.id)] as [string, string]),
  ...brands.map(item => ['b', String(item.id)] as [string, string]),
];

describe('ReferenceLabelsHost', () => {
  it('reads a page of 50 rows naming 2 entities in 2 requests, and a later screen in none', async () => {
    const offeringRepo = counted(offerings);
    const brandRepo = counted(brands);
    const registrations: ReferenceLabelRegistration[] = [
      [Offering, offeringRepo.context],
      [Brand, brandRepo.context],
    ];

    function Screens() {
      const [second, setSecond] = useState(false);
      return second ? (
        <Rows ids={[['o', 'o-3']]} />
      ) : (
        <>
          <Rows ids={page} />
          <button type="button" onClick={() => setSecond(true)}>
            open
          </button>
        </>
      );
    }

    render(
      <EntifixQueryProvider>
        <ReferenceLabelsHost registrations={registrations}>
          <Screens />
        </ReferenceLabelsHost>
      </EntifixQueryProvider>,
    );

    await waitFor(() => {
      expect(screen.getByText('Offering 24')).toBeInTheDocument();
      expect(screen.getByText('Brand 24')).toBeInTheDocument();
    });
    expect(offeringRepo.load).toHaveBeenCalledTimes(1);
    expect(brandRepo.load).toHaveBeenCalledTimes(1);

    screen.getByRole('button', { name: 'open' }).click();
    await waitFor(() =>
      expect(screen.getByText('Offering 3')).toBeInTheDocument(),
    );
    expect(offeringRepo.load).toHaveBeenCalledTimes(1);
  });

  it('reads an id no record answers as the noun and the id', async () => {
    const repository = counted([]);
    render(
      <EntifixQueryProvider>
        <ReferenceLabelsHost registrations={[[Offering, repository.context]]}>
          <Rows ids={[['o', 'o-gone']]} />
        </ReferenceLabelsHost>
      </EntifixQueryProvider>,
    );
    await waitFor(() =>
      expect(screen.getByText('offering o-gone')).toBeInTheDocument(),
    );
  });

  it('reads a failed request as the noun and the id, without an alert', async () => {
    const repository = counted([], true);
    render(
      <EntifixQueryProvider>
        <ReferenceLabelsHost registrations={[[Offering, repository.context]]}>
          <Rows ids={[['o', 'o-1']]} />
        </ReferenceLabelsHost>
      </EntifixQueryProvider>,
    );
    await waitFor(() =>
      expect(screen.getByText('offering o-1')).toBeInTheDocument(),
    );
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('fails one target without touching another, and has no noun for an unregistered key', async () => {
    function Noun() {
      return <p>{String(useReferenceLabels().noun?.('sales:order'))}</p>;
    }
    render(
      <EntifixQueryProvider>
        <ReferenceLabelsHost
          registrations={[
            [Offering, counted(offerings).context],
            [Brand, counted([], true).context],
          ]}
        >
          <Rows
            ids={[
              ['o', 'o-1'],
              ['b', 'b-1'],
            ]}
          />
          <Noun />
        </ReferenceLabelsHost>
      </EntifixQueryProvider>,
    );
    await waitFor(() => {
      expect(screen.getByText('Offering 1')).toBeInTheDocument();
      expect(screen.getByText('brand b-1')).toBeInTheDocument();
    });
    expect(screen.getByText('undefined')).toBeInTheDocument();
  });

  it('shows an unregistered entity raw, and tells the host once per key', () => {
    const warn = vi.fn();
    render(
      <EntifixQueryProvider>
        <ReferenceLabelsHost registrations={[]} onUnregistered={warn}>
          <Rows
            ids={[
              ['x', 'order-1'],
              ['x', 'order-2'],
            ]}
          />
        </ReferenceLabelsHost>
      </EntifixQueryProvider>,
    );
    expect(screen.getByText('order-1')).toBeInTheDocument();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith('sales:order');
  });

  it('names a record by its reference through the same read', async () => {
    @entity({ domain: 'stock', key: 'item', labelMember: 'offeringId' })
    class StockItem extends Values {
      @accessor({ type: 'string', references: { entity: 'catalog:offering' } })
      get offeringId(): string {
        return this.read('offeringId');
      }
    }
    function Name() {
      const nameOf = useRecordLabel();
      return <p>{nameOf(StockItem, { offeringId: 'o-2' })}</p>;
    }
    const repository = counted(offerings);
    render(
      <EntifixQueryProvider>
        <ReferenceLabelsHost registrations={[[Offering, repository.context]]}>
          <Name />
        </ReferenceLabelsHost>
      </EntifixQueryProvider>,
    );
    await waitFor(() =>
      expect(screen.getByText('Offering 2')).toBeInTheDocument(),
    );
  });
});

describe('the crud entry', () => {
  it('no longer exports the per-id label reader it replaced', async () => {
    const crud = await import('./index.js');
    expect(crud).not.toHaveProperty('useLinkLabels');
    expect(crud).not.toHaveProperty('LinkLabelCell');
    expect(crud).toHaveProperty('ReferenceLabelsHost');
  });
});
