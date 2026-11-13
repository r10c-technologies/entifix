import {
  accessor,
  describeEntityUseCases,
  Entity,
  entity,
  EntityId,
  isUseCaseAvailable,
  useCase,
} from '../../index.js';

const PARCEL_STATES = ['waiting', 'sent', 'refused', 'returned'] as const;

@entity({ domain: 'shipping', key: 'parcel' })
class Parcel implements Entity {
  #id?: EntityId;
  #state?: string;
  #note?: string;

  @accessor({ type: 'id' })
  get id(): EntityId {
    return this.#id;
  }
  set id(value: EntityId) {
    this.#id = value;
  }

  @accessor({ type: 'enum', enumValues: PARCEL_STATES, alias: 'status' })
  get state(): string | undefined {
    return this.#state;
  }
  set state(value: string | undefined) {
    this.#state = value;
  }

  @accessor({ type: 'string' })
  get note(): string | undefined {
    return this.#note;
  }
  set note(value: string | undefined) {
    this.#note = value;
  }
}

@useCase({
  entity: Parcel,
  key: 'send',
  binding: 'entity',
  placement: 'context-independent',
  labelKey: 'entity:parcel.useCases.send',
  availableWhen: { member: 'state', in: ['waiting'] },
})
class SendParcelUC {}

@useCase({
  entity: Parcel,
  key: 'track',
  binding: 'entity',
  placement: 'context-independent',
  labelKey: 'entity:parcel.useCases.track',
})
class TrackParcelUC {}

const declare = (availableWhen: { member: string; in: readonly string[] }) =>
  useCase({
    entity: Parcel,
    key: 'return',
    binding: 'entity',
    placement: 'context-independent',
    labelKey: 'entity:parcel.useCases.return',
    availableWhen,
  })(class ReturnParcelUC {}, { metadata: {} } as ClassDecoratorContext);

describe('availableWhen', () => {
  it('is carried onto the served descriptor', () => {
    expect(SendParcelUC).toBeDefined();
    expect(TrackParcelUC).toBeDefined();
    const [send, track] = describeEntityUseCases(Parcel);
    expect(send.availableWhen).toEqual({ member: 'state', in: ['waiting'] });
    expect(track.availableWhen).toBeUndefined();
  });

  it('refuses a member named by its wire alias rather than its own name', () => {
    expect(() => declare({ member: 'status', in: ['sent'] })).toThrow(
      /Parcel has no enum member by that name/,
    );
  });

  it('refuses a member that is not an enum', () => {
    expect(() => declare({ member: 'note', in: ['sent'] })).toThrow(
      /no enum member by that name/,
    );
  });

  it('refuses an empty list of states', () => {
    expect(() => declare({ member: 'state', in: [] })).toThrow(
      /available in no state of "state"/,
    );
  });

  it('refuses a state the member does not hold, naming every one', () => {
    expect(() =>
      declare({ member: 'state', in: ['refused', 'lost', 'stolen'] }),
    ).toThrow(/names "lost", "stolen", which "state" does not hold/);
  });

  it('refuses a verb on no record — unbound, or over a selection alone', () => {
    expect(() =>
      useCase({
        entity: Parcel,
        key: 'sweep',
        binding: 'collection',
        placement: 'context-dependent',
        labelKey: 'entity:parcel.useCases.sweep',
        availableWhen: { member: 'state', in: ['waiting'] },
      })(class SweepParcelsUC {}, { metadata: {} } as ClassDecoratorContext),
    ).toThrow(/sits on no record/);
  });

  it('accepts a collection verb that is also offered on a record', () => {
    expect(() =>
      useCase({
        entity: Parcel,
        key: 'ship',
        binding: 'collection',
        placement: 'context-dependent',
        alsoAt: [{ binding: 'entity', placement: 'context-dependent' }],
        labelKey: 'entity:parcel.useCases.ship',
        availableWhen: { member: 'state', in: ['waiting'] },
      })(class ShipParcelsUC {}, { metadata: {} } as ClassDecoratorContext),
    ).not.toThrow();
  });

  it('refuses an unbound verb, which has no record to be in a state', () => {
    expect(() =>
      useCase({
        entity: Parcel,
        key: 'import',
        binding: 'unbound',
        placement: 'context-independent',
        labelKey: 'entity:parcel.useCases.import',
        availableWhen: { member: 'state', in: ['waiting'] },
      })(class ImportParcelsUC {}, { metadata: {} } as ClassDecoratorContext),
    ).toThrow(/sits on no record/);
  });
});

describe('isUseCaseAvailable', () => {
  const send = { availableWhen: { member: 'state', in: ['waiting'] } };

  it('offers a verb that declares no states on any record, even one in flight', () => {
    expect(isUseCaseAvailable({}, undefined)).toBe(true);
    expect(isUseCaseAvailable({}, { state: 'sent' })).toBe(true);
  });

  it('offers a state-bound verb only on a record in one of its states', () => {
    expect(isUseCaseAvailable(send, { state: 'waiting' })).toBe(true);
    expect(isUseCaseAvailable(send, { state: 'sent' })).toBe(false);
  });

  it('reads the state off an entity instance', () => {
    const parcel = new Parcel();
    parcel.state = 'waiting';
    expect(isUseCaseAvailable(send, parcel)).toBe(true);
  });

  it('withholds a state-bound verb while the record is in flight, or stateless', () => {
    expect(isUseCaseAvailable(send, undefined)).toBe(false);
    expect(isUseCaseAvailable(send, {})).toBe(false);
    expect(isUseCaseAvailable(send, { state: 3 })).toBe(false);
  });
});
