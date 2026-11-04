import {
  defineFragment,
  type FragmentDescriptor,
  type SlipStep,
} from '@entifix/business/flow';
import { Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { makeBindings } from './bindings.js';

const contract = {
  input: Schema.Unknown,
  output: Schema.Unknown,
  failure: Schema.Unknown,
};

const fragmentOf = (
  id: string,
  keys: Pick<FragmentDescriptor, 'provides' | 'consumes'>,
): FragmentDescriptor =>
  defineFragment({
    id: `spec.${id}`,
    version: 1,
    module: 'spec',
    kind: 'retriable',
    participant: 'spec',
    call: { method: 'POST', path: `/api/${id}` },
    cardinality: 'one',
    contract,
    ...keys,
  });

const reserve = fragmentOf('reserve', {
  provides: { reservationId: Schema.String },
});
const write = fragmentOf('write', {
  provides: { orderId: Schema.String, total: Schema.Number },
});
const convert = fragmentOf('convert', {
  consumes: { reservationId: Schema.String },
});
const capture = fragmentOf('capture', {
  consumes: { orderId: Schema.String, groupId: Schema.String },
});

const stepOf = (name: string, extra: Partial<SlipStep> = {}): SlipStep => ({
  ref: `spec.${name}@1`,
  step: name,
  cardinality: 'one',
  ...extra,
});

describe('makeBindings', () => {
  it('binds a single provided key from the answer’s id, inside an envelope or not', () => {
    const bindings = makeBindings();
    const line = (key: string, vendor = 'v-1'): Partial<SlipStep> => ({
      segment: { vendor, paymentMethod: 'card' },
      line: key,
    });

    bindings.record(stepOf('r1', line('o-1')), reserve, {
      meta: { type: 'reservation' },
      data: { id: 'res-1' },
    });
    bindings.record(stepOf('r2', line('o-2')), reserve, { id: 'res-2' });

    expect(
      bindings.inputsFor(
        stepOf('c1', { ...line('o-1'), parameters: { quantity: 1 } }),
        convert,
        'action',
      ),
    ).toEqual({ quantity: 1, reservationId: 'res-1' });
    expect(
      bindings.inputsFor(stepOf('c2', line('o-2')), convert, 'action'),
    ).toEqual({ reservationId: 'res-2' });
    // Another vendor's line of the same key is another scope.
    expect(
      bindings.inputsFor(stepOf('c3', line('o-1', 'v-2')), convert, 'action'),
    ).toEqual({});
  });

  it('reads a key by its own name before the id, and binds nothing it was not given', () => {
    const bindings = makeBindings();
    bindings.record(stepOf('w'), write, {
      data: { id: 'ignored', orderId: 'ord-1' },
    });
    bindings.record(stepOf('nothing'), undefined, 'not a record');
    bindings.record(stepOf('array'), write, ['not', 'a', 'record']);
    // One key, and an answer with no id either: nothing to bind.
    bindings.record(stepOf('anonymous'), reserve, { data: {} });

    expect(bindings.inputsFor(stepOf('cap'), capture, 'action')).toEqual({
      orderId: 'ord-1',
    });
    expect(bindings.inputsFor(stepOf('conv'), convert, 'action')).toEqual({});
  });

  it('gives a step outside every segment what each segment bound, by vendor', () => {
    const bindings = makeBindings();
    bindings.record(
      stepOf('v-1/card:write', { segment: { vendor: 'v-1' } }),
      write,
      { orderId: 'ord-1' },
    );
    bindings.record(
      stepOf('cod:write', { segment: { paymentMethod: 'cod' } }),
      write,
      { orderId: 'ord-2' },
    );
    bindings.record(
      stepOf('group'),
      fragmentOf('group', {
        provides: { groupId: Schema.String },
      }),
      { id: 'g-1' },
    );

    expect(bindings.inputsFor(stepOf('cap'), capture, 'action')).toEqual({
      orderId: { 'v-1': 'ord-1', cod: 'ord-2' },
      groupId: 'g-1',
    });
    // A segment's own step reads its own, never the map.
    expect(
      bindings.inputsFor(
        stepOf('v-1:cap', { segment: { vendor: 'v-1' } }),
        capture,
        'action',
      ),
    ).toEqual({ orderId: 'ord-1', groupId: 'g-1' });
    expect(
      bindings.inputsFor(
        stepOf('v-3:cap', { segment: { vendor: 'v-3' } }),
        capture,
        'action',
      ),
    ).toEqual({ groupId: 'g-1' });
  });

  it('leaves a key no segment bound absent for a step outside every segment', () => {
    const bindings = makeBindings();
    bindings.record(
      stepOf('v-1:o-1:reserve', { segment: { vendor: 'v-1' }, line: 'o-1' }),
      reserve,
      { id: 'res-1' },
    );

    expect(bindings.inputsFor(stepOf('cap'), capture, 'action')).toEqual({});
  });

  it('hands an undoing what its own action answered, its id included', () => {
    const bindings = makeBindings();
    const step = stepOf('reserve', { parameters: { organizationId: 'org-1' } });
    bindings.record(step, reserve, { data: { id: 'res-1' } });
    const bare = stepOf('bare');
    bindings.record(bare, undefined, { ok: true });

    expect(bindings.inputsFor(step, reserve, 'compensation')).toEqual({
      organizationId: 'org-1',
      id: 'res-1',
      reservationId: 'res-1',
    });
    expect(bindings.inputsFor(bare, undefined, 'compensation')).toEqual({});
    expect(
      bindings.inputsFor(stepOf('never-ran'), reserve, 'compensation'),
    ).toEqual({});
  });
});
