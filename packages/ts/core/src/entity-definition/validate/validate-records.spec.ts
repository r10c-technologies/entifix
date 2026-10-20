import { describe, expect, it } from 'vitest';

import { EntifixBuildError } from '../../base-entities/entifix-error/index.js';
import type { Entity, EntityId } from '../../types/Entity.js';
import { accessor } from '../decorators/accessor/index.js';
import { entity } from '../decorators/entity/index.js';
import { describeEntityColumns } from '../describe/index.js';
import { EntityCollectionLink } from '../links/entity-collection-link/index.js';
import { EntityLink } from '../links/entity-link/index.js';
import {
  RecordValidationError,
  validateRecords,
  validRecordsOrThrow,
} from './validate-records.js';

/*
 * Fixtures are getters only: the validator reads metadata and never builds an
 * instance, so nothing here needs to hold a value.
 */

@entity({ key: 'area' })
class Area implements Entity {
  @accessor({ type: 'id' })
  get id(): EntityId {
    return undefined;
  }
}

@entity({ key: 'period' })
class Period implements Entity {
  @accessor({ type: 'id' })
  get id(): EntityId {
    return undefined;
  }
  @accessor({ type: 'string', required: true })
  get role(): string | undefined {
    return undefined;
  }
  @accessor({ type: 'enum', enumValues: ['full', 'part'] })
  get kind(): string | undefined {
    return undefined;
  }
  @accessor({ type: 'number' })
  get hours(): number | undefined {
    return undefined;
  }
  @accessor({ type: 'boolean' })
  get current(): boolean | undefined {
    return undefined;
  }
  @accessor({ type: 'date', required: true })
  get start(): Date | undefined {
    return undefined;
  }
  @accessor({ type: 'date', notBefore: 'start' })
  get end(): Date | undefined {
    return undefined;
  }
  @accessor({ type: 'scalarCollection', minItems: 1, maxItems: 2 })
  get tags(): readonly string[] {
    return [];
  }
  @accessor({ type: 'composition', alias: 'lines' })
  get items(): readonly object[] {
    return [];
  }
  @accessor({ type: 'link' })
  get area(): EntityLink<Area> {
    return new EntityLink(Area);
  }
  @accessor({ type: 'linkCollection' })
  get areas(): EntityCollectionLink<Area> {
    return new EntityCollectionLink(Area);
  }
}

@entity({ key: 'profile', cardinality: { min: 1, max: 1 } })
class Profile implements Entity {
  @accessor({ type: 'id' })
  get id(): EntityId {
    return undefined;
  }
}

const valid = {
  id: 'p-1',
  role: 'Lead',
  kind: 'full',
  hours: 40,
  current: true,
  start: '2024-01-01',
  end: '2025-01-01',
  tags: ['a'],
  lines: [],
  area: 'a-1',
  areas: ['a-1', { id: 'a-2' }],
};

const problemsOf = (records: unknown[], options = {}) =>
  validateRecords(Period, records, { source: 'periods.json', ...options })
    .problems;

describe('validateRecords', () => {
  it('passes a valid record and parses its dates', () => {
    const { problems, records } = validateRecords(Period, [valid]);

    expect(problems).toEqual([]);
    expect(records[0]?.['start']).toEqual(new Date('2024-01-01'));
    expect(records[0]?.['role']).toBe('Lead');
  });

  it('reports what is not a record, and an id missing or used twice', () => {
    expect(problemsOf([42, { ...valid, id: '' }, valid, valid])).toEqual([
      { path: 'periods.json › #0', message: 'is not a record' },
      { path: 'periods.json › #1 › id', message: 'is missing' },
      { path: 'periods.json › p-1 › id', message: 'is used more than once' },
    ]);
  });

  it('reports a required member that is missing, and nothing else about it', () => {
    expect(problemsOf([{ ...valid, role: null }])).toEqual([
      {
        path: 'periods.json › p-1 › role',
        message: 'is required, and is missing',
      },
    ]);
  });

  it('checks each scalar against its declared type', () => {
    expect(
      problemsOf([
        {
          ...valid,
          role: {},
          kind: 'gig',
          hours: 'forty',
          current: 'yes',
          tags: 'a',
          lines: {},
        },
      ]).map(problem => problem.message),
    ).toEqual([
      'holds a object, not text',
      'holds "gig", which is not one of ["full","part"]',
      'holds "forty", not a number',
      'holds "yes", not a boolean',
      'is not a list',
      'is not a list',
    ]);
  });

  it('reports an enum with no declared values against an empty list', () => {
    @entity({ key: 'loose' })
    class Loose implements Entity {
      @accessor({ type: 'id' })
      get id(): EntityId {
        return undefined;
      }
      @accessor({ type: 'enum' })
      get kind(): string | undefined {
        return undefined;
      }
    }
    expect(
      validateRecords(Loose, [{ id: 'x', kind: 'a' }]).problems[0]?.message,
    ).toBe('holds "a", which is not one of []');
  });

  it('parses a date from a string, a number or a Date, and reports the rest', () => {
    const at = new Date('2024-01-01');
    expect(
      validateRecords(Period, [{ ...valid, start: at.getTime(), end: at }])
        .records[0]?.['end'],
    ).toBe(at);
    expect(
      problemsOf([
        { ...valid, id: 'a', start: 'soon' },
        { ...valid, id: 'b', start: new Date('nope') },
        { ...valid, id: 'c', start: true },
      ]).map(problem => problem.message),
    ).toEqual([
      'is not a date: "soon"',
      'is an invalid date',
      'holds a boolean, not a date',
    ]);
  });

  it('checks link ids against the targets it is given, and their shape always', () => {
    expect(
      problemsOf(
        [
          { ...valid, area: 'a-9', areas: ['a-1', true] },
          { ...valid, id: 'p-2', area: 'a-1', areas: 'a-1' },
        ],
        { linkTargets: { area: new Set(['a-1']) } },
      ),
    ).toEqual([
      {
        path: 'periods.json › p-1 › area',
        message: 'points at "a-9", which does not exist',
      },
      {
        path: 'periods.json › p-1 › areas',
        message: 'holds a boolean where an id was expected',
      },
      { path: 'periods.json › p-2 › areas', message: 'is not a list' },
    ]);
  });

  it('holds a collection to its item counts', () => {
    expect(
      problemsOf([
        { ...valid, id: 'a', tags: [] },
        { ...valid, id: 'b', tags: ['x', 'y', 'z'] },
      ]).map(problem => problem.message),
    ).toEqual([
      'holds 0 items, and needs at least 1',
      'holds 3 items, and takes at most 2',
    ]);
  });

  it('refuses an end before its start, and ignores one with no end', () => {
    expect(
      problemsOf([
        { ...valid, end: '2023-01-01' },
        { ...valid, id: 'p-2', end: undefined },
      ]),
    ).toEqual([
      { path: 'periods.json › p-1 › end', message: 'is before start' },
    ]);
  });

  it('holds the whole set to the entity cardinality', () => {
    expect(validateRecords(Profile, []).problems).toEqual([
      { path: 'Profile', message: 'has 0 records, and needs at least 1' },
    ]);
    expect(
      validateRecords(Profile, [{ id: 'a' }, { id: 'b' }]).problems,
    ).toEqual([
      { path: 'Profile', message: 'has 2 records, and takes at most 1' },
    ]);
    expect(validateRecords(Profile, [{ id: 'a' }]).problems).toEqual([]);
  });

  it("runs the caller's rules over the parsed records", () => {
    const problems = problemsOf([valid, { ...valid, id: '' }], {
      rules: [
        (
          records: ReadonlyArray<Readonly<Record<string, unknown>>>,
          report: (i: number, m: string | undefined, s: string) => void,
        ) => {
          expect(records[0]?.['start']).toBeInstanceOf(Date);
          report(0, 'role', 'is not a role we know');
          report(1, undefined, 'is odd');
        },
      ],
    });

    expect(problems.slice(-2)).toEqual([
      { path: 'periods.json › p-1 › role', message: 'is not a role we know' },
      { path: 'periods.json › #1', message: 'is odd' },
    ]);
  });
});

describe('validRecordsOrThrow', () => {
  it('returns the parsed records when they pass', () => {
    expect(validRecordsOrThrow(Period, [valid])).toHaveLength(1);
  });

  it('throws every problem at once, as a build error', () => {
    let error: RecordValidationError | undefined;
    try {
      validRecordsOrThrow(Period, [{ ...valid, role: '', hours: 'x' }], {
        source: 'periods.json',
      });
    } catch (caught) {
      error = caught as RecordValidationError;
    }

    expect(error).toBeInstanceOf(RecordValidationError);
    expect(error).toBeInstanceOf(EntifixBuildError);
    expect(error?.problems).toHaveLength(2);
    expect(error?.message).toBe(
      'Records are invalid:\n' +
        '  periods.json › p-1 › role is required, and is missing\n' +
        '  periods.json › p-1 › hours holds "x", not a number',
    );
  });
});

describe('declaring constraints', () => {
  it('refuses item counts on a member that is not a collection', () => {
    @entity({ key: 'bad-count' })
    class BadCount implements Entity {
      @accessor({ type: 'id' })
      get id(): EntityId {
        return undefined;
      }
      @accessor({ type: 'string', minItems: 1 })
      get name(): string | undefined {
        return undefined;
      }
    }
    expect(() => describeEntityColumns(BadCount)).toThrow(
      /"name" is a string, and only a collection can declare minItems or maxItems/,
    );
  });

  it('refuses counts that cannot be honoured', () => {
    @entity({ key: 'bad-range' })
    class BadRange implements Entity {
      @accessor({ type: 'id' })
      get id(): EntityId {
        return undefined;
      }
      @accessor({ type: 'scalarCollection', minItems: 3, maxItems: 1 })
      get tags(): readonly string[] {
        return [];
      }
    }
    expect(() => describeEntityColumns(BadRange)).toThrow(
      /"tags" declares a minimum of 3 above its maximum of 1/,
    );
    expect(() => {
      @entity({ key: 'bad-cardinality', cardinality: { min: -1 } })
      class BadCardinality implements Entity {
        id: EntityId;
      }
      return BadCardinality;
    }).toThrow(
      /BadCardinality's cardinality declares a count that is not a whole number/,
    );
  });

  it('refuses notBefore unless both ends are dates of the entity', () => {
    @entity({ key: 'bad-order' })
    class BadOrder implements Entity {
      @accessor({ type: 'id' })
      get id(): EntityId {
        return undefined;
      }
      @accessor({ type: 'date', notBefore: 'nowhere' })
      get end(): Date | undefined {
        return undefined;
      }
    }
    expect(() => describeEntityColumns(BadOrder)).toThrow(
      /"end" declares notBefore "nowhere", and both must be date members/,
    );
  });
});
