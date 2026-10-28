import { Exit, Schema } from 'effect';

import {
  defaultStatus,
  type EntifixFailure,
  FAILURE_CATEGORIES,
} from './failure.js';
import { ProtocolFailure } from './generic.js';
import { failureTypeUri, lookupFailure } from './registry.js';

/** The content type every error answer carries (RFC 9457). */
export const PROBLEM_CONTENT_TYPE = 'application/problem+json';

/**
 * The envelope of an RFC 9457 problem, with entifix's members beside the
 * standard ones. `code` is top-level because it is what a client translates;
 * the failure's own fields ride as extension members.
 */
export const Problem = Schema.Struct({
  type: Schema.String,
  title: Schema.String,
  status: Schema.Number,
  code: Schema.String,
  category: Schema.Literals(FAILURE_CATEGORIES),
  detail: Schema.optionalKey(Schema.String),
  instance: Schema.optionalKey(Schema.String),
  traceId: Schema.optionalKey(Schema.String),
});

/** A problem body: the envelope plus the failure's own fields. */
export type Problem = typeof Problem.Type & Readonly<Record<string, unknown>>;

export interface ProblemOptions {
  /** The status to answer with; the category's default when absent. */
  readonly status?: number;
  readonly traceId?: string;
  /** The request path the failure answers. */
  readonly instance?: string;
}

/**
 * The failure's own fields, encoded by the class that registered its code.
 *
 * ⚠️ Encoded through the **registered** class, not the instance's
 * constructor, so a failure decoded elsewhere encodes the same way. A failure
 * whose code nothing registered — impossible through the definers — encodes
 * with no fields rather than leaking whatever it carries.
 */
const encodedFields = (
  failure: EntifixFailure,
): Readonly<Record<string, unknown>> => {
  const registered = lookupFailure(failure.code);
  if (registered === undefined) return {};
  const encoded = Schema.encodeUnknownExit(
    registered.failureClass as unknown as Schema.Codec<unknown, unknown>,
  )(failure);
  if (Exit.isFailure(encoded)) return {};
  const { _tag: _ignored, ...fields } = encoded.value as Record<
    string,
    unknown
  >;
  return fields;
};

/**
 * The problem body a failure answers with.
 *
 * `detail` is the failure's `message` when it has one, and is never
 * `String(error)`: a failure's message is written by its author for a reader,
 * a defect's text is not, and a defect never reaches this function.
 */
export const problemOf = (
  failure: EntifixFailure,
  options: ProblemOptions = {},
): Problem => ({
  ...encodedFields(failure),
  type: failureTypeUri(failure.code),
  title: failure._tag,
  status: options.status ?? defaultStatus(failure.category),
  code: failure.code,
  category: failure.category,
  ...(failure.message === '' ? {} : { detail: failure.message }),
  ...(options.instance === undefined ? {} : { instance: options.instance }),
  ...(options.traceId === undefined ? {} : { traceId: options.traceId }),
});

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * The failure a problem body names, with its typed fields — or a
 * {@link ProtocolFailure} when the body is not a problem, names a code nothing
 * registered, or carries fields that do not decode.
 *
 * Never throws and never fails: whatever a peer sends, the caller gets a
 * failure it can branch on.
 *
 * @param status the HTTP status the body arrived with, kept on a
 *   `ProtocolFailure` so the caller still knows what the peer meant.
 */
export const decodeProblem = (
  body: unknown,
  status?: number,
): EntifixFailure => {
  const protocol = (reason: string) =>
    new ProtocolFailure({
      reason,
      ...(status === undefined ? {} : { upstreamStatus: status }),
    });

  if (!isRecord(body) || typeof body['code'] !== 'string')
    return protocol('the error body is not a problem');

  const registered = lookupFailure(body['code']);
  if (registered === undefined)
    return protocol(`the problem names an unknown code '${body['code']}'`);

  const decoded = Schema.decodeUnknownExit(
    registered.failureClass as unknown as Schema.Codec<unknown, unknown>,
  )({ ...body, _tag: registered.tag });

  return Exit.isSuccess(decoded)
    ? (decoded.value as EntifixFailure)
    : protocol(`the fields of '${body['code']}' do not decode`);
};
