import { describe, expect, it } from 'vitest';

import { StaleRevision } from '../failure/index.js';
import type { Entity } from '../types/Entity.js';
import { accessor } from './decorators/accessor/index.js';
import { entity } from './decorators/entity/index.js';
import { describeEntityColumns } from './describe/index.js';
import { cloneEntityDraft, reconstructEntity } from './reconstruct/index.js';
import { bumpRevision, declaresRevision, readRevision } from './revision.js';
import { validateRecords } from './validate/index.js';

@entity({ key: 'revised' })
class Revised implements Entity {
  #id?: string;
  #name?: string;
  #revision?: number;

  @accessor({ type: 'id' })
  get id() {
    return this.#id;
  }
  set id(value: string | undefined) {
    this.#id = value;
  }

  @accessor({ type: 'string' })
  get name() {
    return this.#name;
  }
  set name(value: string | undefined) {
    this.#name = value;
  }

  @accessor({ type: 'revision' })
  get revision() {
    return this.#revision;
  }
  set revision(value: number | undefined) {
    this.#revision = value;
  }
}

@entity({ key: 'plain' })
class Plain implements Entity {
  #id?: string;

  @accessor({ type: 'id' })
  get id() {
    return this.#id;
  }
  set id(value: string | undefined) {
    this.#id = value;
  }
}

describe('a revision member', () => {
  it('is declared by its type, and an entity without one is not revised', () => {
    expect(declaresRevision(Revised)).toBe(true);
    expect(declaresRevision(Plain)).toBe(false);
  });

  it('presents as nothing, and is neither sortable nor filterable', () => {
    const revision = describeEntityColumns(Revised).find(
      column => column.name === 'revision',
    );

    expect(revision).toMatchObject({
      type: 'revision',
      presentation: 'none',
      sortable: false,
      filterable: false,
      required: false,
    });
    expect(
      describeEntityColumns(Revised).find(column => column.name === 'name'),
    ).not.toHaveProperty('presentation');
  });

  it('is read as a finite number, and as nothing otherwise', () => {
    expect(readRevision({ revision: 3 })).toBe(3);
    expect(readRevision({ revision: undefined })).toBeUndefined();
    expect(readRevision({ revision: '3' })).toBeUndefined();
    expect(readRevision({ revision: Number.NaN })).toBeUndefined();
    expect(readRevision(null)).toBeUndefined();
  });

  it('states its increment for each engine', () => {
    expect(bumpRevision.mongo).toEqual({ $inc: { revision: 1 } });
    expect(bumpRevision.sql).toBe('revision = revision + 1');
  });

  it('is cleared when a record is copied, because a copy is a create', () => {
    expect(
      cloneEntityDraft(Revised, { id: '7', name: 'Acme', revision: '4' }),
    ).toEqual({ id: '', name: 'Acme', revision: '' });
  });

  it('is rebuilt as a number from a draft', () => {
    const rebuilt = reconstructEntity(Revised, {
      id: '7',
      name: 'Acme',
      revision: '4',
    });

    expect(rebuilt.revision).toBe(4);
  });

  it('is validated as a number', () => {
    expect(
      validateRecords(Revised, [{ id: '1', name: 'a', revision: 'x' }])
        .problems,
    ).toHaveLength(1);
    expect(
      validateRecords(Revised, [{ id: '1', name: 'a', revision: 2 }]).problems,
    ).toHaveLength(0);
  });
});

describe('describing a revision member', () => {
  it.each([
    ['required', { required: true }],
    ['filterable', { filterable: true }],
    ['sortable', { sortable: true }],
    ['hidden', { hidden: true }],
    ['readonly', { readonly: true }],
  ])('refuses one declared %s', (flag, options) => {
    @entity({ key: 'bad' })
    class Bad implements Entity {
      @accessor({ type: 'id' })
      get id(): string | undefined {
        return undefined;
      }
      @accessor({ type: 'revision', ...options })
      get revision(): number | undefined {
        return undefined;
      }
    }

    expect(() => describeEntityColumns(Bad)).toThrow(
      new RegExp(`cannot be ${flag}`),
    );
  });

  it('refuses a revision under another name, or an alias', () => {
    @entity({ key: 'renamed' })
    class Renamed implements Entity {
      @accessor({ type: 'id' })
      get id(): string | undefined {
        return undefined;
      }
      @accessor({ type: 'revision' })
      get version(): number | undefined {
        return undefined;
      }
    }
    @entity({ key: 'aliased' })
    class Aliased implements Entity {
      @accessor({ type: 'id' })
      get id(): string | undefined {
        return undefined;
      }
      @accessor({ type: 'revision', alias: 'rev' })
      get revision(): number | undefined {
        return undefined;
      }
    }

    expect(() => describeEntityColumns(Renamed)).toThrow(/must be named/);
    expect(() => describeEntityColumns(Aliased)).toThrow(/must be named/);
  });

  it('refuses a second revision member, which could only be under another name', () => {
    @entity({ key: 'twice' })
    class Twice implements Entity {
      @accessor({ type: 'id' })
      get id(): string | undefined {
        return undefined;
      }
      @accessor({ type: 'revision' })
      get revision(): number | undefined {
        return undefined;
      }
      @accessor({ type: 'revision', hidden: false })
      get revisionTwo(): number | undefined {
        return undefined;
      }
    }

    expect(() => describeEntityColumns(Twice)).toThrow(/must be named/);
  });

  it('refuses a revision on a composition child', () => {
    class Row {
      @accessor({ type: 'revision' })
      get revision(): number | undefined {
        return undefined;
      }
    }
    @entity({ key: 'master' })
    class Master implements Entity {
      @accessor({ type: 'id' })
      get id(): string | undefined {
        return undefined;
      }
      @accessor({ type: 'composition', childType: () => Row })
      get rows(): Row[] {
        return [];
      }
    }

    expect(() => describeEntityColumns(Master)).toThrow(
      /child of a composition/,
    );
  });
});

describe('StaleRevision', () => {
  it('is a business conflict that carries what is stored', () => {
    const failure = new StaleRevision({ entity: 'revised', current: 3 });

    expect(failure.category).toBe('conflict');
    expect(failure.family).toBe('business');
    expect(failure.current).toBe(3);
  });
});
