import type { FragmentDescriptor, SlipStep } from '@entifix/business/flow';

/**
 * What a flow has learned so far, by the keys its fragments `provide`, and the
 * inputs each call is given from it
 * ([ADR 0016](../../../../../docs/adr/0016-a-flow-engine-port-and-a-durable-workflow-adapter.md)).
 *
 * A key is bound in the narrowest scope of the step that provided it — its
 * line, else its segment, else the flow — and a step that `consumes` it reads
 * the nearest: the hold a line's conversion converts is the one taken for that
 * line, not another vendor's. A step outside every segment that consumes a key
 * provided per segment is given all of them, by segment.
 *
 * Built only from what Activities answered, so a replay rebuilds it exactly.
 */
export interface Bindings {
  /** Binds what a step's answer provides. */
  readonly record: (
    step: SlipStep,
    fragment: FragmentDescriptor | undefined,
    answer: unknown,
  ) => void;
  /**
   * The flat inputs one call is given: the step's pinned parameters, beneath
   * what it consumes, beneath — for an undoing — what its own action answered.
   */
  readonly inputsFor: (
    step: SlipStep,
    fragment: FragmentDescriptor | undefined,
    kind: 'action' | 'compensation',
  ) => Readonly<Record<string, unknown>>;
}

type Values = Record<string, unknown>;

const segmentKey = (step: SlipStep): string | undefined =>
  step.segment === undefined
    ? undefined
    : [step.segment.vendor, step.segment.paymentMethod]
        .filter(Boolean)
        .join('/');

const scopeKey = (segment: string | undefined, line: string | undefined) =>
  `${segment ?? ''}|${line ?? ''}`;

const isRecord = (value: unknown): value is Values =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** A field of an answer: inside its envelope's `data` first, else at its top. */
const field = (answer: unknown, key: string): unknown => {
  if (!isRecord(answer)) return undefined;
  const data = answer['data'];
  return isRecord(data) && data[key] !== undefined ? data[key] : answer[key];
};

/**
 * What an answer provides: each key by its own name, and the answer's `id`
 * when a step provides exactly one key the participant did not name — a
 * created record answers its id, not the flow's name for it.
 */
const provided = (
  fragment: FragmentDescriptor | undefined,
  answer: unknown,
): Values => {
  const keys = Object.keys(fragment?.provides ?? {});
  const values: Values = {};
  for (const key of keys) {
    const value = field(answer, key);
    if (value !== undefined) values[key] = value;
    else if (keys.length === 1) {
      const id = field(answer, 'id');
      if (id !== undefined) values[key] = id;
    }
  }
  return values;
};

export const makeBindings = (): Bindings => {
  const scopes = new Map<string, Values>();
  /** What each step's own action answered, for its undoing. */
  const own = new Map<string, Values>();
  /** The name a segment's bindings are given by, to a step outside it. */
  const segmentNames = new Map<string, string>();

  const bind = (scope: string, values: Values) =>
    scopes.set(scope, { ...scopes.get(scope), ...values });

  const consumed = (step: SlipStep, key: string): unknown => {
    const segment = segmentKey(step);
    for (const scope of [
      scopeKey(segment, step.line),
      scopeKey(segment, undefined),
      scopeKey(undefined, undefined),
    ]) {
      const value = scopes.get(scope)?.[key];
      if (value !== undefined) return value;
    }
    if (segment !== undefined) return undefined;
    // A step outside every segment reading a key bound per segment: all of
    // them, by vendor — a capture over every vendor's order.
    const bySegment: Values = {};
    for (const [scope, values] of scopes) {
      const name = segmentNames.get(scope);
      if (name !== undefined && values[key] !== undefined)
        bySegment[name] = values[key];
    }
    return Object.keys(bySegment).length === 0 ? undefined : bySegment;
  };

  return {
    record: (step, fragment, answer) => {
      const values = provided(fragment, answer);
      const id = field(answer, 'id');
      own.set(step.step, id === undefined ? values : { id, ...values });
      const scope = scopeKey(segmentKey(step), step.line);
      // Only a segment's own bindings are offered by name: a line's are its
      // line's, and the flow's are everyone's already.
      if (step.segment !== undefined && step.line === undefined)
        segmentNames.set(
          scope,
          step.segment.vendor ?? String(segmentKey(step)),
        );
      bind(scope, values);
    },
    inputsFor: (step, fragment, kind) => {
      const inputs: Values = { ...step.parameters };
      for (const key of Object.keys(fragment?.consumes ?? {})) {
        const value = consumed(step, key);
        if (value !== undefined) inputs[key] = value;
      }
      return kind === 'compensation'
        ? { ...inputs, ...own.get(step.step) }
        : inputs;
    },
  };
};
