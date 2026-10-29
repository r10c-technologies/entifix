import { Schema } from 'effect';

/**
 * How a step behaves when a later one fails
 * ([ADR 0015](../../../../../docs/adr/0015-composed-flows-and-use-case-resolution.md)).
 *
 * - `compensatable` — can be undone, so it sits before the commit point;
 * - `pivot` — the point of no return, at most one per slip;
 * - `retriable` — after the commit point, retried until it succeeds;
 * - `wait` — a durable wait for a signal, after the commit point.
 */
export type FragmentKind = 'compensatable' | 'pivot' | 'retriable' | 'wait';

/** How many calls one step makes: one, one per vendor segment, or one per line. */
export type FragmentCardinality = 'one' | 'perVendor' | 'perLine';

/**
 * The countermeasure a step relies on for the isolation a saga lacks — what
 * keeps a concurrent flow from seeing, or undoing, its intermediate state.
 */
export type FragmentIsolation =
  | 'commutative'
  | 'semanticLock'
  | 'reRead'
  | 'pessimisticView'
  | 'versionFile'
  | 'none';

/** One HTTP call a step makes on its participant: the public path, never a template. */
export interface FragmentCall {
  readonly method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  readonly path: `/${string}`;
}

/** The facts of a verified context a step may require. */
export interface FragmentRequirements {
  readonly entitlements?: readonly string[];
  readonly roles?: readonly string[];
  readonly partyRoles?: readonly string[];
  readonly channels?: readonly string[];
}

/** A step's contract, as Schemas: what it is given, answers, and refuses with. */
export interface FragmentContract<I, O, F> {
  readonly input: Schema.Codec<I, unknown>;
  readonly output: Schema.Codec<O, unknown>;
  readonly failure: Schema.Codec<F, unknown>;
}

/** Keys a step reads from earlier steps, or makes available to later ones. */
export type FragmentKeys = Readonly<
  Record<string, Schema.Codec<unknown, unknown>>
>;

/**
 * One step a module contributes to a flow, declared beside the use case it
 * calls. Versioned (`id@version`) and typed, so a contract change without a
 * version bump is visible to a catalog snapshot before it reaches a running
 * flow.
 */
export interface FragmentDescriptor<I = unknown, O = unknown, F = unknown> {
  readonly id: string;
  readonly version: number;
  /** The module that owns the step — its domain. */
  readonly module: string;
  readonly kind: FragmentKind;
  /** The service the step calls. Absent only on a marker such as `flow.commit@1`. */
  readonly participant?: string;
  readonly call?: FragmentCall;
  /** Required on a compensatable step unless it is `readOnly`; forbidden otherwise. */
  readonly compensation?: FragmentCall;
  /** A compensatable step that changes nothing, and so has nothing to undo. */
  readonly readOnly?: boolean;
  readonly contract: FragmentContract<I, O, F>;
  readonly requires?: FragmentRequirements;
  readonly consumes?: FragmentKeys;
  readonly provides?: FragmentKeys;
  /** A step whose effect no compensation can reverse — money moved, goods shipped. */
  readonly irreversible?: boolean;
  readonly isolation?: FragmentIsolation;
  readonly cardinality: FragmentCardinality;
  /**
   * Segments this step may not run in, by tag. A card capture excludes the
   * cash-on-delivery segment; the framework names neither.
   */
  readonly excludedFrom?: Readonly<Record<string, readonly string[]>>;
}

/** The pinned reference a slip carries: `stock.reserve@1`. */
export const fragmentRef = (fragment: {
  readonly id: string;
  readonly version: number;
}): string => `${fragment.id}@${String(fragment.version)}`;

/** `domain.verb`, lower kebab, at least two segments. */
const FRAGMENT_ID = /^[a-z][a-z0-9-]*(\.[a-z][a-z0-9-]*)+$/;

const shapeProblems = (fragment: FragmentDescriptor): string[] => {
  const problems: string[] = [];
  if (!FRAGMENT_ID.test(fragment.id))
    problems.push(`its id must be 'domain.verb' in lower kebab case`);
  if (!Number.isInteger(fragment.version) || fragment.version < 1)
    problems.push('its version must be a positive integer');
  const marker =
    fragment.participant === undefined && fragment.call === undefined;
  if (
    !marker &&
    (fragment.participant === undefined || fragment.call === undefined)
  )
    problems.push('it names a participant and a call together, or neither');
  if (marker && fragment.kind !== 'pivot')
    problems.push(
      'only a pivot may be a marker with no participant and no call',
    );
  if (fragment.kind === 'compensatable') {
    if (fragment.compensation === undefined && fragment.readOnly !== true)
      problems.push(
        'a compensatable step declares its compensation, or is readOnly',
      );
  } else if (fragment.compensation !== undefined) {
    problems.push(`a ${fragment.kind} step cannot declare a compensation`);
  }
  if (fragment.irreversible === true && fragment.kind === 'compensatable')
    problems.push('a compensatable step cannot be irreversible');
  return problems;
};

/**
 * Declares a fragment, checking its shape at module load: a malformed
 * descriptor is a programming error and fails the boot, not the first flow
 * that reaches it. What depends on *other* fragments — order, inputs, the
 * commit point — is the validator's, over a whole slip.
 */
export const defineFragment = <I, O, F>(
  fragment: FragmentDescriptor<I, O, F>,
): FragmentDescriptor<I, O, F> => {
  const problems = shapeProblems(fragment as FragmentDescriptor);
  if (problems.length > 0)
    throw new Error(
      `fragment '${fragment.id}@${String(fragment.version)}' is malformed: ${problems.join('; ')}`,
    );
  return fragment;
};

/**
 * The commit point of a flow that has no real pivot: a pivot with no
 * participant and no call. A cash-on-delivery checkout takes no money, and
 * still needs a line past which its stock conversions are retried rather than
 * compensated.
 */
export const flowCommit = defineFragment({
  id: 'flow.commit',
  version: 1,
  module: 'flow',
  kind: 'pivot',
  cardinality: 'one',
  contract: {
    input: Schema.Unknown,
    output: Schema.Unknown,
    failure: Schema.Never,
  },
});

/** A stable 53-bit hash of a string, as hex — enough to see that a contract moved. */
const hash = (text: string): string => {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    h1 = Math.imul(h1 ^ code, 2654435761);
    h2 = Math.imul(h2 ^ code, 1597334677);
  }
  h1 =
    Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^
    Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 =
    Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^
    Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0))
    .toString(16)
    .padStart(14, '0');
};

/** The JSON Schema of a codec, as a plain object. */
export const jsonSchemaOf = (schema: Schema.Codec<unknown, unknown>): unknown =>
  Schema.toJsonSchemaDocument(schema);

/** Consumed or provided keys as JSON Schema, ordered by key. */
export const keysDocument = (keys: FragmentKeys | undefined) =>
  Object.fromEntries(
    Object.entries(keys ?? {})
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, schema]) => [key, jsonSchemaOf(schema)]),
  );

/**
 * A fingerprint of what a fragment promises: its contract and the keys it
 * consumes and provides. It changes when any of those change and on nothing
 * else, so renaming a module or rewording a description never looks like a
 * contract change — and a contract change without a version bump fails the
 * catalog snapshot.
 */
export const fragmentFingerprint = (fragment: FragmentDescriptor): string =>
  hash(
    JSON.stringify({
      input: jsonSchemaOf(
        fragment.contract.input as Schema.Codec<unknown, unknown>,
      ),
      output: jsonSchemaOf(
        fragment.contract.output as Schema.Codec<unknown, unknown>,
      ),
      failure: jsonSchemaOf(
        fragment.contract.failure as Schema.Codec<unknown, unknown>,
      ),
      consumes: keysDocument(fragment.consumes),
      provides: keysDocument(fragment.provides),
    }),
  );
