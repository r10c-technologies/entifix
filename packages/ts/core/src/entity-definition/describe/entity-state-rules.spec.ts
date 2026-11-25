import {
  accessor,
  describeEntityStateRules,
  Entity,
  entity,
  EntityId,
  holdsStoredState,
  isRecordDeletable,
  isRecordWritable,
  storedStateCondition,
  unavailableInState,
  type UseCaseAvailability,
} from '../../index.js';

const VERSION_STATES = ['in-design', 'released', 'retired'] as const;

const declare = (options: {
  writableWhen?: UseCaseAvailability;
  deletableWhen?: UseCaseAvailability;
  readOnlyReasonKey?: string;
}) => {
  @entity({ domain: 'catalog', key: 'version', ...options })
  class Version implements Entity {
    #id?: EntityId;
    #status?: string;
    #title?: string;

    @accessor({ type: 'id' })
    get id(): EntityId {
      return this.#id;
    }
    set id(value: EntityId) {
      this.#id = value;
    }

    @accessor({ type: 'enum', enumValues: VERSION_STATES, alias: 'stage' })
    get status(): string | undefined {
      return this.#status;
    }
    set status(value: string | undefined) {
      this.#status = value;
    }

    @accessor({ type: 'string' })
    get title(): string | undefined {
      return this.#title;
    }
    set title(value: string | undefined) {
      this.#title = value;
    }
  }
  return Version;
};

const IN_DESIGN = { member: 'status', in: ['in-design'] } as const;
const REASON = 'entity:version.readOnly';

describe('an entity declaring the states it may be saved and deleted in', () => {
  it('serves its rules as declared', () => {
    const Version = declare({
      writableWhen: IN_DESIGN,
      deletableWhen: IN_DESIGN,
      readOnlyReasonKey: REASON,
    });
    expect(describeEntityStateRules(Version)).toEqual({
      writableWhen: IN_DESIGN,
      deletableWhen: IN_DESIGN,
      readOnlyReasonKey: REASON,
    });
  });

  it('serves nothing when it declares nothing', () => {
    expect(describeEntityStateRules(declare({}))).toEqual({});
  });

  it('allows a write rule alone', () => {
    const Version = declare({
      writableWhen: IN_DESIGN,
      readOnlyReasonKey: REASON,
    });
    expect(describeEntityStateRules(Version)).not.toHaveProperty(
      'deletableWhen',
    );
  });

  it('allows a delete rule alone', () => {
    const Version = declare({ deletableWhen: IN_DESIGN });
    expect(describeEntityStateRules(Version)).toEqual({
      deletableWhen: IN_DESIGN,
    });
  });

  it('refuses a write rule with no reason to show', () => {
    expect(() => declare({ writableWhen: IN_DESIGN })).toThrow(
      /declares `writableWhen` and no `readOnlyReasonKey`/,
    );
  });

  it('refuses a member that is not an enum', () => {
    expect(() =>
      declare({
        writableWhen: { member: 'title', in: ['x'] },
        readOnlyReasonKey: REASON,
      }),
    ).toThrow(/`writableWhen` is available when "title" holds a state/);
  });

  it('refuses a write rule with no state', () => {
    expect(() =>
      declare({
        writableWhen: { member: 'status', in: [] },
        readOnlyReasonKey: REASON,
      }),
    ).toThrow(/in no state of "status": a record no state lets anyone save/);
  });

  it('refuses a delete rule with no state', () => {
    expect(() =>
      declare({ deletableWhen: { member: 'status', in: [] } }),
    ).toThrow(
      /`deletableWhen` is available in no state.*mounts no delete route/,
    );
  });

  it('refuses a state the member does not hold', () => {
    expect(() =>
      declare({ deletableWhen: { member: 'status', in: ['draft'] } }),
    ).toThrow(/names "draft", which "status" does not hold/);
  });
});

describe('isRecordWritable and isRecordDeletable', () => {
  const rules = { writableWhen: IN_DESIGN, deletableWhen: IN_DESIGN };

  it('allow every record when no rule is declared', () => {
    expect(isRecordWritable(undefined, undefined)).toBe(true);
    expect(isRecordDeletable({}, { status: 'released' })).toBe(true);
  });

  it('allow a record in a declared state', () => {
    expect(isRecordWritable(rules, { status: 'in-design' })).toBe(true);
    expect(isRecordDeletable(rules, { status: 'in-design' })).toBe(true);
  });

  it('refuse a record outside its states, and one still in flight', () => {
    expect(isRecordWritable(rules, { status: 'released' })).toBe(false);
    expect(isRecordDeletable(rules, { status: 'retired' })).toBe(false);
    expect(isRecordWritable(rules, undefined)).toBe(false);
  });
});

describe('storedStateCondition', () => {
  it('resolves a member to the key the store holds it under', () => {
    const Version = declare({});
    expect(storedStateCondition(Version, IN_DESIGN)).toEqual({
      member: 'status',
      key: 'stage',
      in: ['in-design'],
    });
    expect(
      storedStateCondition(Version, { member: 'title', in: ['a'] }).key,
    ).toBe('title');
  });

  it('refuses a member the entity lacks', () => {
    expect(() =>
      storedStateCondition(declare({}), { member: 'phase', in: ['a'] }),
    ).toThrow(/has no member "phase"/);
  });
});

describe('what a store reads back after a conditioned write matched nothing', () => {
  const Version = declare({});
  const condition = storedStateCondition(Version, IN_DESIGN);

  it('tells a stored state it allows from one it does not, by stored key', () => {
    expect(holdsStoredState(condition, { stage: 'in-design' })).toBe(true);
    expect(holdsStoredState(condition, { stage: 'released' })).toBe(false);
    expect(holdsStoredState(condition, { status: 'in-design' })).toBe(false);
    expect(holdsStoredState(condition, null)).toBe(false);
  });

  it('names the refusal by the member, the stored state and the allowed ones', () => {
    expect(
      unavailableInState(Version, condition, { stage: 'released' }),
    ).toMatchObject({
      _tag: 'UnavailableInState',
      code: 'unavailableInState',
      category: 'conflict',
      entity: 'version',
      member: 'status',
      state: 'released',
      allowed: ['in-design'],
    });
  });

  it('names no state when the stored record holds none', () => {
    expect(
      unavailableInState(Version, condition, undefined),
    ).not.toHaveProperty('state');
  });

  it('falls back to the class name for an entity with no key', () => {
    @entity()
    class Unkeyed implements Entity {
      #id?: EntityId;
      #status?: string;

      @accessor({ type: 'id' })
      get id(): EntityId {
        return this.#id;
      }
      set id(value: EntityId) {
        this.#id = value;
      }

      @accessor({ type: 'enum', enumValues: VERSION_STATES })
      get status(): string | undefined {
        return this.#status;
      }
      set status(value: string | undefined) {
        this.#status = value;
      }
    }
    const refusal = unavailableInState(
      Unkeyed,
      storedStateCondition(Unkeyed, IN_DESIGN),
      { status: 'retired' },
    );
    expect(refusal.entity).toBe('Unkeyed');
  });
});
